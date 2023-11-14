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
                if(item.location?.id !== locationId) {
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

export const processNewAccessory = async (accessory, snipeITUser, jiraData, locationId, companyId, issueUrl, locationName) => {
    logger.debug(`Starting process for new accessory: ${accessory ? accessory.name : 'null'} for user ${snipeITUser.name} at location ${locationName}`);

    if (!accessory) {
        logger.debug(`Calling processNewAccessory with accessory: ${accessory ? accessory.name : 'null'}, isNew: ${!accessory}`);
        logger.debug(`No existing accessory found, initiating creation for new accessory.`);

        const accessoryFields = getCustomFieldIds(); // Assuming this function exists and returns an array
        logger.debug(`Accessory fields to be used: ${JSON.stringify(accessoryFields)}`);

        if (!Array.isArray(accessoryFields)) {
            logger.error(`accessoryFields is not an array: ${JSON.stringify(accessoryFields)}`);
            return false; // Exit the function if accessoryFields is not an array
        }

        let allAccessoryNames = getAccessoryNamesFromPayload(jiraData, accessoryFields);
        logger.debug(`Accessory names to create: ${JSON.stringify(allAccessoryNames)}`);

        for (const accessoryName of allAccessoryNames) {
            logger.debug(`Processing creation for accessory: ${accessoryName}`);
            
            // Fetch category ID for accessory
            const categoryId = await getAnyAccessory(accessoryName);
            if (!categoryId) {
                logger.error(`Category ID not found for accessory: ${accessoryName}`);
                continue; // Skip to the next iteration if category ID is not found
            }

            logger.debug(`Creating accessory: ${accessoryName} with Category ID: ${categoryId}`);
            const creationResult = await createNewAccessory(accessoryName, locationId, companyId, categoryId);
            if (!creationResult || creationResult.status !== 'success') {
                logger.error(`Failed to create accessory: ${accessoryName}`);
                continue; // Skip to the next iteration if creation is not successful
            }

            const newAccessoryId = creationResult.payload.id;
            logger.debug(`Created new accessory with ID: ${newAccessoryId}, attempting to check out.`);
            const checkoutResult = await checkoutAccessoryHelper(newAccessoryId, snipeITUser.id, issueUrl);
            if (!checkoutResult) {
                logger.error(`Failed to check out accessory: ${accessoryName}`);
            } else {
                logger.info(`Checked out accessory: ${accessoryName} to user: ${snipeITUser.name}`);
            }
        }
        return true; // Assuming you want to return true if all new accessories have been processed
    } else {
        logger.debug(`Calling processNewAccessory with accessory: ${accessory ? accessory.name : 'null'}, isNew: ${!accessory}`);
        logger.debug(`Accessory ${accessory.name} exists, updating stock and checking out.`);
        await handleExistingAccessoryUpdate(accessory, snipeITUser, issueUrl, locationName);  
        logger.info(`Accessory checked out: ${accessory.name}, stock remaining: ${accessory.remaining_qty}`);
        return true;
    }
};


const handleExistingAccessoryUpdate = async (accessory, snipeITUser, issueUrl) => {
    const newQuantity = accessory.qty + 1;    
    const updateResponse = await updateAccessoryQuantityInSnipeIT(accessory.id, newQuantity, issueUrl);
    await checkoutAccessoryHelper(accessory.id, snipeITUser, issueUrl);
}

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




export async function handleSustainableAccessoryCheckIn(accessoryName, locationId, companyId, categoryId) {
    const sustainableName = `${accessoryName} (Sustainable)`;
    const sustainableAccessories = await fetchAccessoriesByName(process.env.SNIPE_IT_TOKEN, sustainableName);

    if (sustainableAccessories.length > 0) {
        // If the sustainable accessory exists, increment its stock
        const accessoryId = sustainableAccessories[0].id;
        await updateAccessoryQuantityInSnipeIT(accessoryId, sustainableAccessories[0].quantity + 1);
    } else {
        // If the sustainable accessory does not exist, create it with a stock of 1
        await createNewAccessory(sustainableName, locationId, companyId, categoryId);
    }
}


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

    if (originalAccessoryDetails) {
        logger.debug(`Original accessory details: ${JSON.stringify(originalAccessoryDetails)}`);
        
        // Construct the name of the sustainable accessory
        const sustainableName = `${originalAccessoryName} (Sustainable)`;
        logger.debug(`Checking for sustainable accessory: ${sustainableName}`);
        
        // Check for the existence of a sustainable version of the accessory
        const sustainableAccessoryDetailsResponse = await fetchAccessoryDetails(sustainableName, locationId);
        const sustainableAccessoryDetails = sustainableAccessoryDetailsResponse.accessoryDetails;

        // Added logging to verify the response structure
        logger.debug(`Response for sustainable accessory details: ${JSON.stringify(sustainableAccessoryDetailsResponse)}`);

        if (sustainableAccessoryDetails && sustainableAccessoryDetails !== 'create_new') {
            logger.debug(`Sustainable version exists, updating quantity for: ${sustainableName}`);
            await updateAccessoryQuantityInSnipeIT(sustainableAccessoryDetails.id, sustainableAccessoryDetails.quantity + 1);
        } else {
            logger.debug(`No sustainable version found, creating new for: ${sustainableName}`);
            
            // Corrected the property access to the nested values
            const companyId = originalAccessoryDetails.company && originalAccessoryDetails.company.id;
            const categoryId = originalAccessoryDetails.category && originalAccessoryDetails.category.id;

            // Log the companyId and categoryId to see what values are being passed
            logger.debug(`Company ID: ${companyId}, Category ID: ${categoryId}`);
            
            if (companyId && categoryId) {
                await createNewAccessory(sustainableName, locationId, companyId, categoryId);
            } else {
                logger.error(`Cannot create sustainable accessory '${sustainableName}' without a valid companyId and categoryId.`);
            }
        }
        
        // Log before attempting to reduce stock
        logger.debug(`Attempting to reduce stock for original accessory: ${originalAccessoryName}`);
        const newQuantity = originalAccessoryDetails.quantity - 1;
        await updateAccessoryQuantityInSnipeIT(originalAccessoryDetails.id, newQuantity);
        // Log after stock is reduced
        logger.debug(`Stock reduced for original accessory: ${originalAccessoryName}`);
    } else {
        logger.error(`Original accessory not found for conversion to sustainable: ${originalAccessoryName}`);
    }

    logger.debug(`Completed conversion to sustainable for: ${originalAccessoryName}`);
}


