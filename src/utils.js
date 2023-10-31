import { logger } from './logger';
// Imports for Jira
import { 
    fetchCustomFieldContext, 
    fetchCustomFieldOptions, 
    addCustomFieldOptions, 
    deleteCustomFieldOptions 
} from './api';

//Imports for Snipe-IT
import {
    fetchAccessories,
    fetchUsersFromSnipeIT,
    checkoutAccessoryForUser,
    updateAccessoryQuantityInSnipeIT,
    createNewAccessory
} from './api';

// Helper Functions

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

// Utils to Update Jira Fields
export const synchronizeFieldWithOptions = async (fieldId, categoryName) => {
    try {
        const fetchedNames = await fetchAndExtractAccessoryNames(categoryName);
        const context = await fetchCustomFieldContext(fieldId);
        const contextId = context.values[0].id;
        const currentOptions = await fetchCustomFieldOptions(fieldId, contextId);
        
        const { newOptions, obsoleteOptions } = determineOptionChanges(currentOptions, fetchedNames);

        await handleNewOptions(fieldId, contextId, newOptions);
        await handleObsoleteOptions(fieldId, contextId, obsoleteOptions);

        logger.debug("synchronizeFieldWithOptions operation completed successfully.");
    return {
            synchronized: `Added ${newOptions.length} new options and removed ${obsoleteOptions.length} obsolete options.`
        };

    } catch (error) {
        return { error: error.message };
    }
};

// Fetch and extract accessory names from Snipe-IT
export const fetchAndExtractAccessoryNames = async (category) => {
    const data = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
    return extractAccessoryNamesByCategory(data, category);
};

// Extract accessory names based on their category from the provided data.
const extractAccessoryNamesByCategory = (payload, category) => {
    const filtered_accessories = payload.rows.filter(item => item.category.name === category);
    const unique_accessory_names = [...new Set(filtered_accessories.map(item => decodeHtmlEntities(item.name)))];
    logger.debug('Unique Accessories: ', unique_accessory_names);
    return unique_accessory_names;
};

//Custom field ids for Snipe-IT API enabled fields 
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

// Extract new and obsolete options
const determineOptionChanges = (currentOptions, fetchedNames) => {
    const currentOptionValues = currentOptions.values.map(option => option.value);
    const newOptions = fetchedNames.filter(name => !currentOptionValues.includes(name));
    const obsoleteOptions = currentOptions.values.filter(option => !fetchedNames.includes(option.value));
    return { newOptions, obsoleteOptions };
};

// Handle adding new options
const handleNewOptions = async (fieldId, contextId, newOptions) => {
    if (newOptions.length > 0) {
        await addCustomFieldOptions(fieldId, contextId, newOptions);
    }
};

// Handle deleting obsolete options
const handleObsoleteOptions = async (fieldId, contextId, obsoleteOptions) => {
    for (let option of obsoleteOptions) {
        await deleteCustomFieldOptions(fieldId, contextId, option.id);
    }
};

export const getExactAccessory = async (accessoryName, locationId, locationName) => {
    try {
        logger.debug("Fetching all accessories from Snipe-IT...");
        const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
        logger.debug(`Total accessories fetched: ${allAccessories.rows.length}`);

        logger.debug(`Searching for accessory: Name=${accessoryName}, LocationId=${locationId}...`);
        
        // Filter the accessories based on the provided criteria
        const matchedAccessory = allAccessories.rows.find(item => {
            if (item.name === accessoryName) {
                logger.debug(`Accessory with name ${accessoryName} found. Evaluating location...`);
                if(item.location?.id !== locationId) {
                    logger.debug(`Mismatch in Location. Expected: ${locationId}, Found: ${item.location?.id}`);
                }
                return item.location?.id === locationId;
            }
            return false;
        });

        if (matchedAccessory) {
            logger.debug(`Accessory matched: ${accessoryName} with LocationId: ${locationId}, in ${locationName})`);
            return matchedAccessory;
        } else {
            logger.warn(`Accessory not found: ${accessoryName} in ${locationName}`);
            return null;
        }

    } catch (error) {
        logger.error(`Error fetching accessory: ${accessoryName}.`, error);
        return null;
    }
};


export const extractAllAccessories = (accessoriesData) => {
    // Ensure there are rows available in the data
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
    let accessoryNamesList = [];
    for (const field of accessoryFields) {
        const accessoryNames = payload[field] ? payload[field].split(', ') : [];
        accessoryNamesList = accessoryNamesList.concat(accessoryNames);
    }
    return accessoryNamesList.filter(name => name);  // Filter out empty names
};

const checkoutAccessoryHelper = async (accessoryId, snipeITUser, issueUrl) => {
    logger.debug(`Checking out accessory with ID: ${accessoryId} for user ID: ${snipeITUser.id}`);
    return await checkoutAccessoryForUser(accessoryId, snipeITUser.id, issueUrl);
}

export const processStockAccessory = async (accessory, snipeITUser, jiraData, locationId, locationMapping, issueUrl, locationName) => {
    
    // Debugging: Log the entire accessory object
    logger.debug("Accessory Object:", JSON.stringify(accessory));
    
    // Debugging: Log the exact value of remainingQty
    logger.debug(`Remaining stock for accessory ${accessory.name}: ${accessory.remaining_qty}`);

    if (accessory.remaining_qty <= 0) {
        logger.info(`No stock available for accessory: ${accessory.name} in location ${locationName}, moving on to the next Accessory`);
        return;  // Exit the function early
    }
    
    logger.info(`Accessory Checkout: ${accessory.name} with current stock: ${accessory.remaining_qty} in location ${locationName}`);
    logger.debug("Accessory ID:", accessory.id);
    logger.debug("Snipe IT User ID:", snipeITUser.id);

    // Using checkoutAccessoryHelper instead of checkoutAccessoryForUser directly
    const checkoutResponse = await checkoutAccessoryHelper(accessory.id, snipeITUser, issueUrl);
    
    logger.info(`Checked out to ${snipeITUser.name}: ${accessory.name} and current stock remaining in location ${locationName}: ${accessory.remaining_qty - 1}`);
};

export const processNewAccessory = async (accessory, snipeITUser, jiraData, locationId, companyId, issueUrl, locationName) => {
    logger.debug("Inside processNewAccessory - locationId:", locationId, "locationName:", locationName);
    logger.debug("Inside processNewAccessory - companyId:", companyId);
    if (!accessory) {
        logger.debug("[processNewAccessory] Handling new accessory creation for location:", locationName);

        await handleNewAccessoryCreation(snipeITUser, jiraData, locationId, companyId, issueUrl, locationName);  // If needed, you can pass locationName to this function as well.
        return false;
    } else {

        await handleExistingAccessoryUpdate(accessory, snipeITUser, issueUrl, locationName);  // If needed, you can pass locationName to this function as well.
        logger.info(`Accessory exists in Snipe-IT and in this location (${locationName}), updating stock and checking out to user.`);
        logger.info(`Accessory Checked Out to ${snipeITUser.name}: ${accessory.name} and current stock remaining: ${accessory.remaining_qty}`);
        return true;
        
    }
};


const handleNewAccessoryCreation = async (snipeITUser, jiraData, locationId, companyId, issueUrl, locationName) => {
    logger.debug('JiraData:', JSON.stringify(jiraData));

    // Extract accessory names from jiraData
    let allAccessoryNames = [];
    for (const key in customFieldCategories) {
        const customFieldKey = `customfield_${key}`;
        if (jiraData[customFieldKey]) {
            const accessoriesForField = jiraData[customFieldKey].split(',').map(item => item.trim());
            allAccessoryNames = allAccessoryNames.concat(accessoriesForField);
        }
    }    
    logger.debug(`All extracted accessory names from jiraData:`, allAccessoryNames);

    // Pre-fetch category IDs for all accessory names
    const categoryIdsByAccessoryName = {};
    let prefetchLoopCount = 0;
    logger.debug(`Beginning pre-fetch of category IDs for accessories...`);
    for (const accessoryName of allAccessoryNames) {
        prefetchLoopCount++;
        logger.debug(`[Pre-fetch Loop] Iteration count: ${prefetchLoopCount} for accessory ${accessoryName}`);
        
        const existingAccessory = await getAnyAccessory(accessoryName);
        if (existingAccessory && existingAccessory.category && typeof existingAccessory.category.id !== 'undefined') {
            logger.debug(`Found accessory with name ${accessoryName}. Category ID: ${existingAccessory.category.id}`);
            categoryIdsByAccessoryName[accessoryName] = existingAccessory.category.id;
        } else {
            logger.error(`No existing accessory found with the name ${accessoryName}. Can't determine category ID.`);
        }
    }
    logger.debug(`Completed pre-fetching category IDs. Result:`, categoryIdsByAccessoryName);
    logger.debug("Inside processNewAccessory - locationId:", locationId);
    logger.debug("Inside processNewAccessory - companyId:", companyId);

    // Main loop to create and check out accessories
    let creationLoopCount = 0;
    for (const accessoryName of allAccessoryNames) {
        creationLoopCount++;
        logger.debug(`[Creation Loop] Iteration count: ${creationLoopCount} for accessory ${accessoryName}`);

        const categoryId = categoryIdsByAccessoryName[accessoryName];
        if (!categoryId) {
            continue;
        }

        logger.debug(`Attempting to create accessory with Name: ${accessoryName}, Location: ${locationId}, Company: ${companyId}, Category: ${categoryId}`);
        const newAccessory = await createNewAccessory(accessoryName, locationId, companyId, categoryId);
        
        if (!newAccessory || newAccessory.status !== 'success') {
            logger.error(`Failed to add accessory ${accessoryName} to Snipe-IT.`);
            continue;
        }

        const newAccessoryId = newAccessory.payload.id;
        logger.info(`Successfully created accessory with ID: ${newAccessoryId} in in location ${locationName}`);
        logger.debug(`Attempting to checkout accessory ${accessoryName} to user ID: ${snipeITUser.id}`);

        try {
            logger.debug("Issue URL being used for note:", issueUrl);
            await checkoutAccessoryHelper(newAccessoryId, snipeITUser, issueUrl);
            logger.info(`Successfully checked out accessory ${accessoryName} to: ${snipeITUser.name} in location ${locationName}`);
        } catch (error) {
            logger.error(`Failed to checkout accessory ${accessoryName} to user. Error: ${error.message}`);
        }
    }
};

const handleExistingAccessoryUpdate = async (accessory, snipeITUser, issueUrl) => {
    logger.debug(`[Update Function] Executing handleExistingAccessoryUpdate for accessory ID: ${accessory.id}`);
    const newQuantity = accessory.qty + 1;
    logger.debug(`Attempting to update quantity to ${newQuantity}`);
    
    const updateResponse = await updateAccessoryQuantityInSnipeIT(accessory.id, newQuantity, issueUrl);
    logger.debug(`Update Response: `, updateResponse);
    logger.debug("Issue URL being used for note:", issueUrl);
    await checkoutAccessoryHelper(accessory.id, snipeITUser, issueUrl);

}


export const getAnyAccessory = async (accessoryName) => {
    try {
        logger.debug("Fetching all accessories from Snipe-IT...");
        const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
        logger.debug(`Total accessories fetched: ${allAccessories.rows.length}`);

        logger.debug(`Searching for any accessory with Name=${accessoryName}...`);
        
        // Filter the accessories based on the provided name
        const matchedAccessory = allAccessories.rows.find(item => item.name === accessoryName);

        if (matchedAccessory) {
            logger.debug(`Accessory matched by name: ${accessoryName}`);
            logger.debug("getAnyAccessory operation completed successfully.");
        return matchedAccessory;
        } else {
            logger.debug(`Accessory not found by name: ${accessoryName}`);
            return null;
        }

    } catch (error) {
        logger.error(`Error fetching any accessory by name: ${accessoryName}.`, error);
        logger.info("getAnyAccessory operation completed with errors.");
        return null;
    }
};

export const inspectAccessoryStructure = async () => {
    try {
        logger.debug("Fetching all accessories from Snipe-IT for inspection...");
        const allAccessories = await fetchAccessories(process.env.SNIPE_IT_TOKEN);
        
        const testHeadphones = allAccessories.rows.find(item => item.name === "Test Headphones");

        if (testHeadphones) {
            logger.debug("[DEBUG] Test Headphones Accessory Data Structure:", JSON.stringify(testHeadphones, null, 2));
        } else {
            logger.debug("Test Headphones accessory not found in fetched data.");
        }
    } catch (error) {
        logger.error("Error fetching and inspecting accessory structure:", error);
    logger.info("inspectAccessoryStructure operation completed with errors.");
    }
};
