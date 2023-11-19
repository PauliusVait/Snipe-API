import {
    logger
} from './logger';

import {
    fetchCompanies,
    fetchLocations,
    createCompanyInSnipeIT,
    createLocationInSnipeIT,
    fetchCheckedOutAccessoryUsers,
    checkinAccessory

} from './api';

import {
    customFieldCategories,
    fetchSnipeITUser,
    getAccessoryNamesFromPayload,
    getCustomFieldIds,
    processNewAccessory,
    processStockAccessory,
    synchronizeFieldWithOptions,
    getExactAccessory,
    fetchAndLogUserAccessories,
    clearUserAccessoriesCache,
    convertToSustainableAndCheckIn
} from './utils';

import {
    buildOutput,
    buildLogSummaryResponse
} from './responseBuilder';

export const updateCustomField = async () => {
    const updateTasks = Object.entries(customFieldCategories).map(
        ([fieldId, categoryName]) => synchronizeFieldWithOptions(fieldId, categoryName)
    );
    const results = await Promise.all(updateTasks);
    logger.info("Field Update operation completed successfully.");
    return buildOutput(results);
};

export const accessoriesSnipe = async (request) => {

    try {
        const jiraData = JSON.parse(request.body);
        logger.debug(`Received JIRA payload: ${JSON.stringify(jiraData)}`);
        const issueUrl = jiraData.issueUrl;
        const locationName = jiraData.customfield_11213;
        const snipeITUser = await fetchSnipeITUser(jiraData.reporterEmail);
        let locationMapping = await fetchLocations(process.env.SNIPE_IT_TOKEN);
        let companyMapping = await fetchCompanies(process.env.SNIPE_IT_TOKEN);
        let locationId = locationMapping[jiraData.customfield_11213];
        let companyId = companyMapping[jiraData.customfield_11337];

        // Check if location exists, if not, create a new one
        if (!locationId) {
            logger.warn(`Location "${locationName}" not found. Creating in Snipe-IT...`);
            const newLocation = await createLocationInSnipeIT(locationName, process.env.SNIPE_IT_TOKEN);
            locationId = newLocation.id;
            locationMapping[locationName] = locationId;
        }

        // Check if company exists, if not, create a new one
        if (!companyId) {
            const companyName = jiraData.customfield_11337;
            logger.warn(`Company "${companyName}" not found. Creating in Snipe-IT...`);
            const newCompany = await createCompanyInSnipeIT(companyName, process.env.SNIPE_IT_TOKEN);
            companyId = newCompany.id;
            companyMapping[companyName] = companyId;
        }

        const accessoryFields = getCustomFieldIds() || [];
        const accessoryNames = getAccessoryNamesFromPayload(jiraData, accessoryFields);
        logger.info('Accessories assigned to ', JSON.stringify(jiraData.reporterEmail), 'in Snipe-IT BEFORE automation:');
        await fetchAndLogUserAccessories(snipeITUser);

        for (const accessoryName of accessoryNames) {

            const accessory = await getExactAccessory(accessoryName, locationId, locationName);

            if (!accessory && jiraData.customfield_11745 !== 'New Accessory') {
                logger.error(`Accessory ${accessoryName} not found in Snipe-IT for location ${locationName}.`);
                continue; // Skip to the next iteration if accessory is not found and not creating a new one
            }

            switch (jiraData.customfield_11745) {
                case 'Stock Accessory':
                    logger.debug(`Processing Stock Accessory: ${accessoryName}`);
                    await processStockAccessory(accessory, snipeITUser, jiraData, locationId, locationMapping, issueUrl, locationName);

                    break;
                case 'New Accessory':
                    logger.debug(`Processing New Accessory: ${accessoryName}, existing: ${!!accessory}`);
                    const isProcessed = await processNewAccessory(
                        accessoryName, snipeITUser, locationId, companyId, issueUrl, locationName
                    );

                    if (!isProcessed) {
                        logger.error(`Failed to process new accessory ${accessoryName}, result: ${isProcessed}`);
                    }
                    break;
                case '(DO NOT USE) Return Accessory':
                    const checkedOutAccessoriesResponse = await fetchCheckedOutAccessoryUsers(accessory.id);
                    const accessoryToCheckIn = checkedOutAccessoriesResponse.rows.find(acc => acc.username === jiraData.reporterEmail);

                    if (!accessoryToCheckIn) {
                        logger.error(`Accessory ${accessoryName} not found as checked out to username ${jiraData.reporterEmail}.`);
                        continue; // Skip to the next iteration if no checked-out accessory entry is found
                    }

                    // Perform the check-in action
                    await checkinAccessory(accessoryToCheckIn.assigned_pivot_id);

                    logger.debug(`Accessory ${accessoryName} with pivot ID ${accessoryToCheckIn.assigned_pivot_id} successfully checked in.`);

                    // Check if the accessory is sustainable. If it is, do not increment the quantity.
                    if (accessoryName.includes('(Sustainable)')) {
                        logger.debug(`Checked in sustainable accessory without modifying the quantity: ${accessoryName}`);
                    } else {
                        // If it's not a sustainable accessory, proceed with the conversion
                        try {
                            await convertToSustainableAndCheckIn(accessoryName, locationId, locationName);
                        } catch (error) {
                            logger.error(`Failed to convert ${accessoryName} to sustainable: ${error}`);
                        }
                    }
                    break;

                default:
                    logger.error('Invalid accessory type in customfield_11745:', jiraData.customfield_11745);
                    continue; // Skip to the next iteration if the accessory type is invalid
            }
        }
        logger.debug("Clearing user accessories cache.");
        clearUserAccessoriesCache();
        logger.info('Accessories assigned to ', JSON.stringify(jiraData.reporterEmail), 'in Snipe-IT AFTER automation:');
        await fetchAndLogUserAccessories(snipeITUser);
        logger.info("Completed processing all accessories");

        return buildLogSummaryResponse();
    } catch (error) {
        logger.error(`Error in accessoriesSnipe function: ${error.message}`);
        return buildOutput({ error: error.message });
    }
};



export const logJiraPayload = async (request) => {
    try {
        const jiraData = JSON.parse(request.body);
        const snipeITUser = await fetchSnipeITUser(jiraData.reporterEmail);
        if (!snipeITUser) {
            logger.error(`User with email ${jiraData.reporterEmail} not found in Snipe-IT.`);
            return buildOutput({ error: `User with email ${jiraData.reporterEmail} not found in Snipe-IT.` });
        }

        // Instead of fetching all user accessories, fetch the accessories that are checked out to the user
        const response = await fetchCheckedOutAccessoryUsers(snipeITUser.id);

        if (response.status === 'error') {
            logger.error(`Error fetching checked-out accessories: ${response.messages}`);
            return buildOutput({ error: `Error fetching checked-out accessories: ${response.messages}` });
        }

        const checkedOutAccessories = response.rows;
        if (checkedOutAccessories && checkedOutAccessories.length > 0) {
            const accessoriesSummary = checkedOutAccessories.map(acc => {
                return { assigned_pivot_id: acc.assigned_pivot_id, name: acc.name, last_checkout: acc.last_checkout };
            });
            return buildOutput({ "Action": "Checked Out Accessories Fetched", "Count": accessoriesSummary.length, "Accessories": accessoriesSummary });
        } else {
            logger.warn(`No checked-out accessories found for user ID ${snipeITUser.id}`);
            return buildOutput({ "Action": "No Checked Out Accessories Found", "Count": 0 });
        }
    } catch (error) {
        logger.error('Error:', error.message);
        return buildOutput({ error: error.message });
    }
};













