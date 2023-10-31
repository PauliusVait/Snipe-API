import api, { route, fetch } from "@forge/api";
import { logger } from './logger';

// SNIPE-IT API 

//Snipe-IT API Base URL
export const SNIPE_IT_BASE_URL = "https://vinted.snipe-it.io/api/v1";

export const createNewAccessory = async (name, locationId, companyId, categoryId) => {
    try {
        // Enhanced logging to capture input values
        logger.debug(`Attempting to create accessory with Name: ${name}, LocationId: ${locationId}, CompanyId: ${companyId}, CategoryId: ${categoryId}`);

        const options = {
            method: 'POST',
            headers: {
                accept: 'application/json',
                Authorization: `Bearer ${process.env.SNIPE_IT_TOKEN}`,
                'content-type': 'application/json'
            },
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

        // Enhanced logging to capture the response from Snipe-IT
        logger.debug(`Response from Snipe-IT when creating accessory ${name}:`, responseData);
        
        logger.debug("createNewAccessory operation completed successfully.");
        logger.debug("checkoutAccessoryForUser operation completed successfully.");
        logger.debug("updateAccessoryQuantityInSnipeIT operation completed successfully.");
        return responseData;
    } catch (error) {
        logger.error(`Exception while creating accessory ${name} in Snipe-IT:`, error);
        return null;
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
        logger.debug("fetchUsersFromSnipeIT operation completed successfully.");
        logger.debug("fetchCustomFieldContext operation completed successfully.");
        logger.debug("fetchCustomFieldOptions operation completed successfully.");
        return await response.json();
    } catch (error) {
        throw error;
    }
};

// Update Accessory Quantity
export const updateAccessoryQuantityInSnipeIT = async (accessoryId, newQuantity) => {
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
        throw new Error(`Failed to update accessory quantity in Snipe-IT. Status: ${response.status}`);
    }

    logger.debug("fetchAccessories operation completed successfully.");
        logger.debug("fetchUsersFromSnipeIT operation completed successfully.");
        logger.debug("fetchCustomFieldContext operation completed successfully.");
        logger.debug("fetchCustomFieldOptions operation completed successfully.");
        return await response.json();
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
    
    logger.debug("Checkout request body:", JSON.stringify(options));
    logger.debug("Checking out accessory with ID:", accessoryId, "for user ID:", userId);

    const response = await fetch(`${SNIPE_IT_BASE_URL}/accessories/${accessoryId}/checkout`, options);
    
    const responseData = await response.json();
    logger.debug("Checkout Response:", responseData);  
    
    if (!response.ok) {
        logger.error("Failed Checkout Response:", response);
        throw new Error(`Error checking out accessory: ${responseData.error}`);
    }

    return response;
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
        return data.payload;  // Return the newly created location
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
        return data.payload;  // Return the newly created company
    }

    logger.error(`Failed to create Comapny. Invoice To field is empty.`);
};

// Fetch a specific location by name from Snipe-IT
export const fetchLocationByName = async (locationName, token) => {
    const locations = await fetchLocations(token);
    return locations[locationName];  // Return the location ID if found
};

// Fetch a specific company by name from Snipe-IT
export const fetchCompanyByName = async (companyName, token) => {
    const companies = await fetchCompanies(token);
    return companies[companyName];  // Return the company ID if found
};


//  JIRA API

export const addInternalCommentToJira = async (issueKey, commentText) => {
    const bodyData = {
      body: {
        content: [
          {
            content: [
              {
                text: commentText,
                type: "text"
              }
            ],
            type: "paragraph"
          }
        ],
        type: "doc",
        version: 1
      },
      visibility: {
        identifier: "Administrators",
        type: "role",
        value: "Administrators"
      }
    };
  
    // Log the attempt to add the comment
    logger.debug(`Attempting to add comment to Jira issue ${issueKey}...`);
    logger.debug(`Comment text: ${commentText}`);
    
    const response = await api.asUser().requestJira(route`/rest/api/2/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });
  
    // Log the API response status and text
    logger.debug(`API Response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const responseBody = await response.json();
      logger.debug('API Response Body:', responseBody);
      throw new Error(`Failed to add comment to Jira issue. Status: ${response.status} ${response.statusText}`);
    }
  
    logger.debug("fetchAccessories operation completed successfully.");
        logger.debug("fetchUsersFromSnipeIT operation completed successfully.");
        logger.debug("fetchCustomFieldContext operation completed successfully.");
        logger.debug("fetchCustomFieldOptions operation completed successfully.");
        return await response.json();
  };
  


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

        logger.debug("fetchAccessories operation completed successfully.");
        logger.debug("fetchUsersFromSnipeIT operation completed successfully.");
        logger.debug("fetchCustomFieldContext operation completed successfully.");
        logger.debug("fetchCustomFieldOptions operation completed successfully.");
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

        logger.debug("fetchAccessories operation completed successfully.");
        logger.debug("fetchUsersFromSnipeIT operation completed successfully.");
        logger.debug("fetchCustomFieldContext operation completed successfully.");
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

