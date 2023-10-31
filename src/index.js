import { logger } from './logger';

// API-related imports
import { 
    fetchCompanies,
    fetchLocations,
     fetchAccessories,
      createCompanyInSnipeIT,
       createLocationInSnipeIT } from './api';

// Utils-related imports
import {
    customFieldCategories,
    fetchSnipeITUser,
    getAccessoryNamesFromPayload,
    getCustomFieldIds,
    processNewAccessory,
    processStockAccessory,
    synchronizeFieldWithOptions,
    getExactAccessory,
    
} from './utils';

// Response-related imports
import { buildOutput, buildLogSummaryResponse } from './responseBuilder';


// Update Custom Fields for Accessories in Jira based on Snipe-IT Acessory list
export const updateCustomField = async () => {
    const updateTasks = Object.entries(customFieldCategories).map(
        ([fieldId, categoryName]) => synchronizeFieldWithOptions(fieldId, categoryName)
    );
    const results = await Promise.all(updateTasks);
    logger.debug(buildOutput(results))
    logger.info("Field Update operation completed successfully.");
    return buildOutput(results);
};

export const accessoriesSnipe = async (request) => {
    // Initialize the logger's summary
    logger.initializeSummary();

    try {
        const jiraData = JSON.parse(request.body);
        logger.debug("Received JiraData:", JSON.stringify(jiraData));

        var issueUrl = jiraData.issueUrl;

        var locationName = jiraData.customfield_11213;
        logger.debug(locationName)

        const snipeITUser = await fetchSnipeITUser(jiraData.reporterEmail);

        let locationMapping = await fetchLocations(process.env.SNIPE_IT_TOKEN);
        logger.debug("Location Mapping: ", locationMapping);

        let companyMapping = await fetchCompanies(process.env.SNIPE_IT_TOKEN);
        logger.debug("Company Mapping: ", companyMapping);

        let locationId = locationMapping[jiraData.customfield_11213];
        if (!locationId) {
            logger.warn(`Location "${jiraData.customfield_11213}" not found. Creating in Snipe-IT...`);
            const newLocation = await createLocationInSnipeIT(jiraData.customfield_11213, process.env.SNIPE_IT_TOKEN);
            locationId = newLocation.id;
            locationMapping[jiraData.customfield_11213] = locationId;
        }
        logger.debug("Extracted locationId from mapping:", locationId);

        let companyId = companyMapping[jiraData.customfield_11337];
        if (!companyId) {
            logger.warn(`Company "${jiraData.customfield_11337}" not found. Creating in Snipe-IT...`);
            const newCompany = await createCompanyInSnipeIT(jiraData.customfield_11337, process.env.SNIPE_IT_TOKEN);
            companyId = newCompany.id;
            companyMapping[jiraData.customfield_11337] = companyId;
        }
        logger.debug("Extracted companyId from mapping:", companyId);

        logger.debug("Jira location name: ", jiraData.customfield_11213);
        logger.debug("Jira company name: ", jiraData.customfield_11337);
        const accessoryFields = getCustomFieldIds();
        const accessoryNames = getAccessoryNamesFromPayload(jiraData, accessoryFields);
        logger.debug("Accessories to process:", accessoryNames);
        
        let shouldContinueProcessing = true;

        for (const accessoryName of accessoryNames) {
            logger.debug(`Processing accessory: ${accessoryName}`);
            const accessory = await getExactAccessory(accessoryName, locationId, locationName);            
            switch (jiraData.customfield_11745) {
                case 'Stock Accessory':
                    if (!accessory) {
                        logger.error(`Stock Accessory ${accessoryName} not found in Snipe-IT for location ${locationName}. Consider adding it first.`);
                        logger.incrementErrorCount(); 
                        continue;
                    }
                    logger.debug(`About to checkout accessory: ${accessoryName} with current stock: ${accessory.qty}`);
                    await processStockAccessory(accessory, snipeITUser, jiraData, locationId, locationMapping, issueUrl, locationName);
                    logger.debug(`Successfully processed stock accessory: ${accessoryName}`);
                    break;
                case 'New Accessory':
                    logger.debug("Before calling processNewAccessory - locationId:", locationId);
                    logger.debug("Before calling processNewAccessory - companyId:", companyId);
                    shouldContinueProcessing = await processNewAccessory(accessory, snipeITUser, jiraData, locationId, companyId, issueUrl, locationName);
                    logger.debug(`Should continue after processing ${accessoryName}:`, shouldContinueProcessing);
                    if (!shouldContinueProcessing) {
                        break; // Exit the switch case
                    }
                    break;
                default:
                    throw new Error('Invalid accessory type in customfield_11745');
            }
            if (!shouldContinueProcessing) {
                break;
            }
        }
        
        logger.info("Completed processing all accessories");
        return buildLogSummaryResponse();
    } catch (error) {
        logger.error('Error:', error.message);
        return buildOutput({ error: error.message });
    }
};



export const logJiraPayload = async (request) => {
    try {
        // 1. Log the Jira Payload
        const jiraData = JSON.parse(request.body);
        logger.debug("Received Jira Payload:", jiraData);
        
        // 2. Inspect the accessory structure
        const inspectAccessoryStructure = async () => {
            try {
                logger.debug("Fetching all accessories from Snipe-IT for inspection...");
                const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
                
                const testHeadphones = allAccessories.rows.find(item => item.name === "Test Headphones");
        
                if (testHeadphones) {
                    logger.debug("Test Headphones Accessory Data Structure:", JSON.stringify(testHeadphones, null, 2));
                } else {
                    logger.error("Test Headphones accessory not found in fetched data.");
                }
            } catch (error) {
                logger.error("Error fetching and inspecting accessory structure:", error);
            }
        };
        await inspectAccessoryStructure();

        

        logger.info("logJiraPayload operation completed successfully.");
    return buildOutput({ "Action": "Payload Logged and Accessory Inspected" });
    } catch (error) {
        logger.error('Error:', error.message);
        return buildOutput({ error: error.message });
    }
};











