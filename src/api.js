
// Define default headers for API requests
const defaultHeaders = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${process.env.SNIPE_IT_TOKEN}`,
    'Content-Type': 'application/json'
};

import api, { route, fetch } from "@forge/api";
import { logger } from './logger';

// SNIPE-IT API 

//Snipe-IT API Base URL
export const SNIPE_IT_BASE_URL = "https://vinted.snipe-it.io/api/v1";

export const createNewAccessory = async (name, locationId, companyId, categoryId) => {
    try {
        logger.debug(`Attempting to create accessory with Name: ${name}, LocationId: ${locationId}, CompanyId: ${companyId}, CategoryId: ${categoryId}`);
        
        if (!companyId || !categoryId) {
            const errorMessage = `Cannot create accessory '${name}' without a valid CompanyId and CategoryId.`;
            logger.error(errorMessage);
            return { status: 'error', message: errorMessage };
        }

        const options = {
            method: 'POST',
            headers: defaultHeaders,
            body: JSON.stringify({
                name: name,
                qty: 1,
                category_id: categoryId,
                location_id: locationId,
                company_id: companyId
            })
        };

        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories`, options);
        const responseData = await response.json();

        if (!response.ok) {
            logger.error(`Failed to create accessory '${name}': ${responseData.error}`);
            return { status: 'error', message: responseData.error };
        }

        logger.info(`Accessory '${name}' created successfully with ID: ${responseData.id}`);
        return { status: 'success', payload: responseData };
    } catch (error) {
        logger.error(`Exception when creating accessory '${name}': ${error.message}`);
        return { status: 'error', message: error.message };
    }
};


export const fetchAccessoryDetails = async (accessoryName, locationId) => {
    try {
        logger.debug(`Fetching details for accessory: '${accessoryName}' at location ID: ${locationId}`);

        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories?search=${encodeURIComponent(accessoryName.trim())}`, {
            headers: {
                'Authorization': `Bearer ${process.env.SNIPE_IT_TOKEN}`,
                'Accept': 'application/json'
            }
        });

        // Verbose logging of the response status
        logger.debug(`Response Status for fetching details of ${accessoryName}: ${response.status}`);

        if (!response.ok) {
            const errorBody = await response.text();
            logger.error(`Failed to fetch details for accessory '${accessoryName}': ${errorBody}`);
            return { error: errorBody };
        }

        const data = await response.json();
        logger.debug(`Raw API response for accessory details: ${JSON.stringify(data)}`);

        if (data.total === 0) {
            logger.debug(`No details found for accessory: '${accessoryName}' at location ID: ${locationId}. Suggesting creation of a new accessory.`);
            return { action: 'create_new' };
        }

        const accessoryDetails = data.rows.find(item => 
            item.name.trim().toLowerCase() === accessoryName.trim().toLowerCase() && 
            Number(item.location.id) === Number(locationId)
        );

        if (!accessoryDetails) {
            logger.error(`Accessory not found: '${accessoryName}' at location ID: ${locationId}`);
            return { error: 'not_found' };
        }

        logger.debug(`Found accessory details: ${JSON.stringify(accessoryDetails)}`);
        return { accessoryDetails };
    } catch (error) {
        logger.error(`Error while fetching details for accessory '${accessoryName}': ${error}`);
        logger.error(error.stack); // Logging stack trace for more detail
        return { error: error.toString() };
    }
};




// Retrieve Accessories from Snipe-IT
export const fetchAccessories = async (token) => {
    try {
        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch accessories. Status: ${response.status}`);
        }

        logger.debug("fetchAccessories operation completed successfully.");

        return await response.json();
    } catch (error) {
        throw error;
    }
};

export async function fetchAccessoriesByName(token, accessoryName) {
    try {
        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories?search=${encodeURIComponent(accessoryName)}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        return data.rows.filter(accessory => accessory.name === accessoryName);
    } catch (error) {
        console.error(`Error fetching accessories by name: ${error}`);
        throw error;
    }
}


// Update Accessory Quantity
export const updateAccessoryQuantityInSnipeIT = async (accessoryId, newQuantity) => {
    logger.debug(`Updating quantity for accessory ID ${accessoryId} to ${newQuantity}`);
    const options = {
        method: 'PATCH',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`,  
            'content-type': 'application/json'
        },
        body: JSON.stringify({ qty: newQuantity })
    };

    const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories/${accessoryId}`, options);
    
    if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`Failed to update accessory quantity in Snipe-IT for ID ${accessoryId}: ${errorBody}`);
        throw new Error(`Failed to update accessory quantity in Snipe-IT. Status: ${response.status}`);
    }

    const responseData = await response.json();
    logger.debug(`Accessory quantity updated successfully for ID ${accessoryId}: ${JSON.stringify(responseData)}`);
    return responseData;
};


//  Retrieve user from Snipe-IT 
export const fetchUsersFromSnipeIT = async (reporterName) => {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`
        }
    };
    const response = await fetch(`${SNIPE_IT_BASE_URL}/users?search=${reporterName}&limit=50`, options);
    const data = await response.json();

    // Log the entire response
    logger.debug(`All users fetched for reporter name ${reporterName}:`, data.rows);

    const matchedUser = data.rows.find(user => user.email === reporterName || user.username === reporterName);
    
    if (!matchedUser) {
        throw new Error(`User with name ${reporterName} not found in Snipe-IT.`);
    }

    // Log the matched user's ID
    logger.debug(`Matched user ID for ${reporterName} in Snipe-IT:`, matchedUser.id);

    return matchedUser;
};

//  Checking out (assigning) Accessory to user in Snipe-IT
export const checkoutAccessoryForUser = async (accessoryId, userId, issueUrl) => {
    logger.debug("Issue URL being used for note:", issueUrl);
    let noteValue = typeof issueUrl === "string" ? issueUrl : issueUrl.issueUrl;

    const options = {
        method: 'POST',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            assigned_to: userId,
            note: noteValue
        })
    };
    
    //logger.debug("Checkout request body:", JSON.stringify(options));
    logger.debug("Checking out accessory with ID:", accessoryId, "for user ID:", userId);

    const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories/${accessoryId}/checkout`, options);
    
    const responseData = await response.json();
    //logger.debug("Checkout Response:", responseData);  
    
    if (!response.ok) {
        logger.error("Failed Checkout Response:", response);
        throw new Error(`Error checking out accessory: ${responseData.error}`);
    }

    return response;
};

export const fetchCheckedOutAccessoryUsers = async (accessoryId) => {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`
        }
    };

    logger.debug(`Fetching checked out users for accessory ID ${accessoryId} with options: ${JSON.stringify(options)}`);

    try {
        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories/${accessoryId}/checkedout`, options);

        // New log for full response status and headers
        logger.debug(`Response status: ${response.status}`);
        logger.debug(`Response headers: ${JSON.stringify(response.headers.raw())}`);

        if (!response.ok) {
            logger.debug(`Non-OK HTTP response for checked out users: ${response.status} ${response.statusText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // New logs to check the data structure
        logger.debug(`Parsed response data for checked out users: ${JSON.stringify(data, null, 2)}`);
        if (data.rows) {
            logger.debug(`Data contains 'rows' property with length: ${data.rows.length}`);
        } else {
            logger.debug(`Data does not contain 'rows' property. Actual keys: ${Object.keys(data)}`);
        }

        return data;
    } catch (error) {
        logger.error('Error during fetchCheckedOutAccessoryUsers:', error);
        // New log for error details if the response is available
        if (error.response) {
            logger.error(`Error response status: ${error.response.status}`);
            logger.error(`Error response headers: ${JSON.stringify(error.response.headers.raw())}`);
            logger.error(`Error response data: ${await error.response.text()}`);
        }
        throw error; 
    }
};




export const checkinAccessory = async (assignedPivotId) => {
    const options = {
        method: 'POST',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}` 
        }
    };

    try {
        const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories/${assignedPivotId}/checkin`, options);

        if (!response.ok) {
            logger.error(`Non-OK HTTP response for checking in accessory: ${response.status} ${response.statusText}`);
            const errorBody = await response.text(); 
            logger.debug(`Error response body: ${errorBody}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        logger.debug('Accessory checked in successfully:', JSON.stringify(responseData, null, 2));
        return responseData;
    } catch (error) {
        logger.error('Error during accessory check-in:', error);
        throw error;
    }
};



//  Retrieve Locations from Snipe-IT
export const fetchLocations = async (token) => {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${token}`
        }
    };

    const response = await fetch(`${SNIPE_IT_BASE_URL}/locations?limit=50&offset=0&sort=created_at`, options);
    const data = await response.json();

    const locations = {};
    data.rows.forEach(location => {
        locations[location.name] = location.id;
    });

    return locations;
};

//  Retrieve Companies from Snipe-IT
export const fetchCompanies = async (token) => {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${token}`
        }
    };

    const response = await fetch(`${SNIPE_IT_BASE_URL}/companies`, options);
    const data = await response.json();

    const companies = {};
    data.rows.forEach(company => {
        companies[company.name] = company.id;
    });

    return companies;
};

// Create a new location in Snipe-IT
export const createLocationInSnipeIT = async (locationName, token) => {
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: locationName })
    };

    const response = await fetch(`${SNIPE_IT_BASE_URL}/locations`, options);
    const data = await response.json();

    if (data && data.status === "success") {
        return data.payload;  
    }

    throw new Error(data.error || "Failed to create location in Snipe-IT, User location is empty");
};

// Create a new company in Snipe-IT
export const createCompanyInSnipeIT = async (companyName, token) => {
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: companyName })
    };

    const response = await fetch(`${SNIPE_IT_BASE_URL}/companies`, options);
    const data = await response.json();

    if (data && data.status === "success") {
        return data.payload;  
    }

    logger.error(`Failed to create Comapny. Invoice To field is empty.`);
};

// Fetch a specific location by name from Snipe-IT
export const fetchLocationByName = async (locationName, token) => {
    const locations = await fetchLocations(token);
    return locations[locationName];  
};

// Fetch a specific company by name from Snipe-IT
export const fetchCompanyByName = async (companyName, token) => {
    const companies = await fetchCompanies(token);
    return companies[companyName];  
};

export const fetchUserAccessories = async (userId) => {
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`, 
            }
        };

        const response = await fetch(`${SNIPE_IT_BASE_URL}/users/${userId}/accessories`, options);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch accessories for user ID ${userId}. Status: ${response.status}`);
        }
        
        logger.debug(`fetchUserAccessories operation completed successfully for user ID ${userId}.`);
        return await response.json();
    } catch (error) {
        logger.error(`Exception while fetching accessories for user ID ${userId}:`, error);
        throw error; 
    }
};


//  JIRA API

//  Retrieve Custom Field Context ID 
export const fetchCustomFieldContext = async (fieldId) => {
    try {
        const response = await api.asApp().requestJira(route`/rest/api/3/field/customfield_${fieldId}/context`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch custom field context. Status: ${response.status}`);
        }

        logger.debug("fetchCustomFieldContext operation completed successfully.");

        return await response.json();
    } catch (error) {
        throw error;
    }
};

//Retrieve Custom Field Options. 
export const fetchCustomFieldOptions = async (fieldId, contextId) => {
    try {
        const response = await api.asApp().requestJira(route`/rest/api/3/field/customfield_${fieldId}/context/${contextId}/option`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch custom field options. Status: ${response.status}`);
        }

        logger.debug("fetchCustomFieldOptions operation completed successfully.");

        return await response.json();
    } catch (error) {
        throw error;
    }
};

// Add new custom field options
export const addCustomFieldOptions = async (fieldId, contextId, optionsToAdd) => {
    return await api.asApp().requestJira(route`/rest/api/3/field/customfield_${fieldId}/context/${contextId}/option`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ options: optionsToAdd.map(name => ({ value: name, disabled: false })) })
    });
};

// Update existing custom field options
export const updateCustomFieldOptions = async (fieldId, contextId, optionsToUpdate) => {
    return await api.asApp().requestJira(route`/rest/api/3/field/customfield_${fieldId}/context/${contextId}/option`, {
        method: 'PUT',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ options: optionsToUpdate })
    });
};

// Remove a custom field option
export const deleteCustomFieldOptions = async (fieldId, contextId, optionId) => {
    return await api.asApp().requestJira(route`/rest/api/3/field/customfield_${fieldId}/context/${contextId}/option/${optionId}`, {
        method: 'DELETE'
    });
};

