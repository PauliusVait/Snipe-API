import { logger } from './logger';

import {
    fetchCustomFieldContext,
    fetchCustomFieldOptions,
    addCustomFieldOptions,
    deleteCustomFieldOptions,
    fetchUserAccessories
} from './api';

import {
    fetchAccessories,
    fetchAccessoriesByName,
    fetchUsersFromSnipeIT,
    checkoutAccessoryForUser,
    updateAccessoryQuantityInSnipeIT,
    createNewAccessory,
    fetchAccessoryDetails
} from './api';

function decodeHtmlEntities(str) {
    const entities = {
        "&quot;": '"',
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&apos;": "'"
    };

    return str.replace(/&[^;]+;/g, match => entities[match] || match);
}

export const synchronizeFieldWithOptions = async (fieldId, categoryName) => {
    try {
        const fetchedNames = await fetchAndExtractAccessoryNames(categoryName);
        const context = await fetchCustomFieldContext(fieldId);
        const contextId = context.values[0].id;
        const currentOptions = await fetchCustomFieldOptions(fieldId, contextId);
        const { newOptions, obsoleteOptions } = determineOptionChanges(currentOptions, fetchedNames);
        await handleNewOptions(fieldId, contextId, newOptions);
        await handleObsoleteOptions(fieldId, contextId, obsoleteOptions);
        return {
            synchronized: `Added ${newOptions.length} new options and removed ${obsoleteOptions.length} obsolete options.`
        };

    } catch (error) {
        return { error: error.message };
    }
};

export const fetchAndExtractAccessoryNames = async (category) => {
    const data = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
    return extractAccessoryNamesByCategory(data, category);
};

const extractAccessoryNamesByCategory = (payload, category) => {
    const filtered_accessories = payload.rows.filter(item => item.category.name === category);
    const unique_accessory_names = [...new Set(filtered_accessories.map(item => decodeHtmlEntities(item.name)))];
    return unique_accessory_names;
};

export const customFieldCategories = {
    11720: 'Headphones',
    11724: 'Keyboard',
    11726: 'Mouse',
    11725: 'Monitor',
    11727: 'Miscellaneous Hardware',
    11728: 'Offsite Equipment'
};

export const getCustomFieldIds = () => {
    return Object.keys(customFieldCategories).map(key => `customfield_${key}`);
};

const determineOptionChanges = (currentOptions, fetchedNames) => {
    const currentOptionValues = currentOptions.values.map(option => option.value);
    const newOptions = fetchedNames.filter(name => !currentOptionValues.includes(name));
    const obsoleteOptions = currentOptions.values.filter(option => !fetchedNames.includes(option.value));
    return { newOptions, obsoleteOptions };
};

const handleNewOptions = async (fieldId, contextId, newOptions) => {
    if (newOptions.length > 0) {
        await addCustomFieldOptions(fieldId, contextId, newOptions);
    }
};

const handleObsoleteOptions = async (fieldId, contextId, obsoleteOptions) => {
    for (let option of obsoleteOptions) {
        await deleteCustomFieldOptions(fieldId, contextId, option.id);
    }
};

export const getExactAccessory = async (accessoryName, locationId, locationName) => {
    try {
        const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
        const matchedAccessory = allAccessories.rows.find(item => {
            if (item.name === accessoryName) {
                if (item.location?.id !== locationId) {
                }
                return item.location?.id === locationId;
            }
            return false;
        });

        if (matchedAccessory) {
            return matchedAccessory;
        } else {
            logger.error(`Accessory not found: ${accessoryName} in ${locationName}`);
            return null;
        }

    } catch (error) {
        logger.error(`Error fetching accessory: ${accessoryName}.`, error);
        return null;
    }
};


export const extractAllAccessories = (accessoriesData) => {
    if (!accessoriesData.rows || !Array.isArray(accessoriesData.rows)) {
        throw new Error('Invalid accessories data format');
    }

    return accessoriesData.rows.map(accessory => ({
        id: accessory.id,
        name: decodeHtmlEntities(accessory.name),
        locationId: accessory.location.id,
        companyId: accessory.company.id,
        categoryId: accessory.category.id,
        qty: accessory.qty,
        remainingQty: accessory.remaining_qty
    }));
};

export const fetchSnipeITUser = async (email) => {
    const snipeITUser = await fetchUsersFromSnipeIT(email);
    if (!snipeITUser) {
        throw new Error(`User ${email} not found in Snipe-IT`);
    }
    return snipeITUser;
};

export const getAccessoryNamesFromPayload = (payload, accessoryFields) => {
    logger.debug(`Received payload: ${JSON.stringify(payload)}`);
    logger.debug(`Expected accessory fields: ${JSON.stringify(accessoryFields)}`);

    let accessoryNamesList = [];
    for (const field of accessoryFields) {
        logger.debug(`Processing field: ${field}`);
        const accessoryNames = payload[field] ? payload[field].split(', ') : [];
        accessoryNamesList = accessoryNamesList.concat(accessoryNames);
    }
    return accessoryNamesList.filter(name => name);
};


const checkoutAccessoryHelper = async (accessoryId, snipeITUser, issueUrl) => {
    return await checkoutAccessoryForUser(accessoryId, snipeITUser.id, issueUrl);
}

export const processStockAccessory = async (accessory, snipeITUser, jiraData, locationId, locationMapping, issueUrl, locationName) => {
    if (accessory.remaining_qty <= 0) {
        logger.warn(`No stock available for accessory: ${accessory.name} in location ${locationName}, moving on to the next Accessory`);
        return;
    }
    logger.info(`Accessory Checkout: ${accessory.name} with current stock: ${accessory.remaining_qty} in location ${locationName}`);
    const checkoutResponse = await checkoutAccessoryHelper(accessory.id, snipeITUser, issueUrl);
    logger.info(`Checked out to ${snipeITUser.name}: ${accessory.name} and current stock remaining in location ${locationName}: ${accessory.remaining_qty - 1}`);
};

export const processNewAccessory = async (accessoryName, snipeITUser, locationId, companyId, issueUrl, locationName) => {
    logger.debug(`Processing accessory: ${accessoryName} for user ${snipeITUser.name} ID: ${snipeITUser.id} at location ${locationName}`);

    // Check if the accessory already exists in the specified location
    const existingAccessory = await getExactAccessory(accessoryName, locationId, locationName);

    if (existingAccessory) {
        // Accessory exists, so increase stock and check out if necessary
        logger.debug(`Accessory ${accessoryName} exists, updating stock.`);
        return await handleExistingAccessoryUpdate(existingAccessory, snipeITUser, issueUrl);
    } else {
        // Accessory does not exist, so create a new one
        logger.debug(`Creating new accessory: ${accessoryName}`);
        const categoryId = await getAnyAccessory(accessoryName); // Function to get category ID based on accessory name
        if (!categoryId) {
            logger.error(`Category ID not found for accessory: ${accessoryName}`);
            return false; // Exit function if category ID is not found
        }

        // Create the new accessory
        const creationResult = await createNewAccessory(accessoryName, locationId, companyId, categoryId);

        // Check if creationResult is successful and has a valid ID
        if (creationResult && creationResult.status === 'success' && creationResult.payload && creationResult.payload.id) {
            // Successfully created the accessory
            const newAccessoryId = creationResult.payload.id;
            logger.info(`Accessory '${accessoryName}' created successfully with ID: ${newAccessoryId}`);

            // Attempt to check out the accessory
            const checkoutResult = await checkoutAccessoryHelper(newAccessoryId, snipeITUser, issueUrl);
            if (!checkoutResult) {
                logger.error(`Failed to check out accessory: ${accessoryName}`);
                return false;
            }
            logger.info(`Checked out accessory: ${accessoryName} to user: ${snipeITUser.name}`);
            return true;
        } else {
            // Accessory creation failed
            logger.error(`Failed to create accessory: ${accessoryName}`);
            return false;
        }
    };

};

const handleExistingAccessoryUpdate = async (accessory, snipeITUser, issueUrl) => {
    // Update the stock quantity for an existing accessory
    const newQuantity = accessory.qty + 1;
    const updateResponse = await updateAccessoryQuantityInSnipeIT(accessory.id, newQuantity);
    if (!updateResponse) {
        logger.error(`Failed to update stock for accessory: ${accessory.name}`);
        return false;
    }

    // Check out the accessory to the user if necessary
    const checkoutResult = await checkoutAccessoryHelper(accessory.id, snipeITUser, issueUrl);
    if (!checkoutResult) {
        logger.error(`Failed to check out accessory: ${accessory.name}`);
        return false;
    }

    logger.info(`Accessory ${accessory.name} stock increased and checked out to user ${snipeITUser.name}.`);
    return true;
};


export const getAnyAccessory = async (accessoryName) => {
    try {
        const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
        //logger.debug(`All accessories fetched: ${JSON.stringify(allAccessories)}`);

        const matchedAccessory = allAccessories.rows.find(item => {
            logger.debug(`Checking accessory: ${item.name}`);
            return item.name === accessoryName;
        });

        if (matchedAccessory) {
            logger.debug(`Matched accessory: ${JSON.stringify(matchedAccessory)}`);
            // Replace 'category_id' with the actual property name for the category ID
            return matchedAccessory.category.id;
        } else {
            logger.error(`Accessory not found or category ID missing for: ${accessoryName}`);
            return null;
        }

    } catch (error) {
        logger.error(`Error fetching any accessory by name: ${accessoryName}.`, error);
        return null;
    }
};


let cachedUserAccessories = null;

export const fetchAndLogUserAccessories = async (snipeITUser) => {
    try {
        if (cachedUserAccessories && cachedUserAccessories.userId === snipeITUser.id) {
            return cachedUserAccessories.data;
        }

        const response = await fetchUserAccessories(snipeITUser.id);
        const userAccessories = response.rows;
        if (userAccessories && userAccessories.length > 0) {
            const accessoriesSummary = userAccessories.map(acc => ({ id: acc.id, name: acc.name }));

            accessoriesSummary.forEach(acc => {
                logger.info(`Accessory ID: ${acc.id}, Name: ${acc.name}`);
            });

            cachedUserAccessories = {
                userId: snipeITUser.id,
                data: { "Action": "User Accessories Fetched", "Count": accessoriesSummary.length, "Accessories": accessoriesSummary }
            };

            return cachedUserAccessories.data;
        } else {
            logger.warn(`No accessories found for user ID ${snipeITUser.id}`);
            return { "Action": "No Accessories Found", "Count": 0 };
        }
    } catch (error) {
        logger.error('Error:', error.message);
        throw new Error(error.message);
    }
};

export const clearUserAccessoriesCache = () => {
    cachedUserAccessories = null;
};

export async function convertToSustainableAndCheckIn(originalAccessoryName, locationId, locationName) {
    logger.debug(`Starting conversion to sustainable for: ${originalAccessoryName}`);

    // Fetch the detailed information of the original accessory
    const originalAccessoryDetailsResponse = await fetchAccessoryDetails(originalAccessoryName, locationId);
    const originalAccessoryDetails = originalAccessoryDetailsResponse.accessoryDetails;

    // Added logging to verify the response structure
    logger.debug(`Response for original accessory details: ${JSON.stringify(originalAccessoryDetailsResponse)}`);

    if (originalAccessoryDetails && typeof originalAccessoryDetails.qty === 'number') {
        logger.debug(`Original accessory details: ${JSON.stringify(originalAccessoryDetails)}`);

        // Construct the name of the sustainable accessory
        const sustainableName = `${originalAccessoryName} (Sustainable)`;
        logger.debug(`Checking for sustainable accessory: ${sustainableName}`);

        // Check for the existence of a sustainable version of the accessory
        const sustainableAccessoryDetailsResponse = await fetchAccessoryDetails(sustainableName, locationId);
        const sustainableAccessoryDetails = sustainableAccessoryDetailsResponse.accessoryDetails;

        // Added logging to verify the response structure
        logger.debug(`Response for sustainable accessory details: ${JSON.stringify(sustainableAccessoryDetailsResponse)}`);

        if (sustainableAccessoryDetails && typeof sustainableAccessoryDetails.qty === 'number') {
            logger.debug(`Sustainable version exists, updating quantity for: ${sustainableName}`);
            await updateAccessoryQuantityInSnipeIT(sustainableAccessoryDetails.id, sustainableAccessoryDetails.qty + 1);
        } else {
            // Assume you have a utility function to derive the category ID from the accessory name
            const categoryId = await getAnyAccessory(originalAccessoryName);
            
            if (!categoryId) {
                logger.error(`Category ID not found for accessory: ${originalAccessoryName}`);
                // ... Error handling for missing category ID
                return;
            }
        
            // Re-use the existing company ID from the original accessory details
            const companyId = originalAccessoryDetails.company.id;
            const locationId = originalAccessoryDetails.location.id; // Assuming this comes from originalAccessoryDetails
        
            // Construct the sustainable accessory name
            const sustainableName = `${originalAccessoryName} (Sustainable)`;
        
            // Create the new sustainable accessory
            const creationResult = await createNewAccessory(sustainableName, locationId, companyId, categoryId);
        
            if (creationResult && creationResult.status === 'success' && creationResult.payload && creationResult.payload.id) {
                const newSustainableAccessoryId = creationResult.payload.id;
                logger.info(`Sustainable accessory '${sustainableName}' created successfully with ID: ${newSustainableAccessoryId}`);
                // If you need to check out the sustainable accessory to the user, you can do so here
                // For example:
                // await checkoutAccessoryHelper(newSustainableAccessoryId, snipeITUser, issueUrl);
            } else {
                logger.error(`Failed to create sustainable accessory: ${sustainableName}`);
                // ... Error handling for accessory creation failure
            }
        }

        // Log before attempting to reduce stock
        logger.debug(`Attempting to reduce stock for original accessory: ${originalAccessoryName}`);
        const newQuantity = originalAccessoryDetails.qty - 1;

        // Validate newQuantity before attempting to update
        if (typeof newQuantity === 'number' && !isNaN(newQuantity)) {
            await updateAccessoryQuantityInSnipeIT(originalAccessoryDetails.id, newQuantity);
            logger.debug(`Stock reduced for original accessory: ${originalAccessoryName}`);
        } else {
            logger.error(`Calculated newQuantity is invalid for accessory ID ${originalAccessoryDetails.id}: ${newQuantity}`);
            // ... Error handling
        }
    } else {
        logger.error(`Original accessory not found or quantity is not a number for conversion to sustainable: ${originalAccessoryName}`);
        // ... Error handling for missing accessory or quantity issue
    }

    logger.debug(`Completed conversion to sustainable for: ${originalAccessoryName}`);
}




