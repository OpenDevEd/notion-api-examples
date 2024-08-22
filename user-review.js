#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define the new config directory
const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'notion-api-examples');
const configTmpDir = path.join(configDir, 'tmp');

console.log(configDir);
console.log(configTmpDir);

// Ensure the config directories exist
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}
if (!fs.existsSync(configTmpDir)) {
    fs.mkdirSync(configTmpDir, { recursive: true });
}

const fieldsWherePrevStaffNeedsToBeRemoved = ["To do","Acknowledged", "Mi nuh need dis"];

function executeNotionCli(command, pageId, changeDir = true) {
    if (changeDir) {
        const currentDir = process.cwd();
        process.chdir(configTmpDir);
        try {
            return execSync(`notion-cli ${command} ${pageId}`, { encoding: 'utf-8' });
        } finally {
            process.chdir(currentDir);
        }
    } else {
        return execSync(`notion-cli ${command} ${pageId}`, { encoding: 'utf-8' });
    }
}

function getData(pageId) {
    // Read the JSON file

    const rawData = executeNotionCli('page', pageId);
    const data = JSON.parse(rawData);
    fs.writeFileSync(path.join(configTmpDir, 'page.json'), rawData);

    // Function to extract all properties of type 'people'
    function extractPeopleProperties(result) {
        const extractedProperties = {};
    
        for (const [key, value] of Object.entries(result.properties)) {
            if (value.type === 'people') {
                extractedProperties[key] = {
                    id: value.id,
                    type: value.type,
                    people: value.people.map(person => ({
                        id: person.id                
                    }))
                };
            }
        }
    
        return Object.keys(extractedProperties).length > 0 ? { properties: extractedProperties } : null;
    }

    // Extract all 'people' properties from the first result (assuming there's only one)
    const extractedData = extractPeopleProperties(data.result[0]);

    // Output the result
    if (extractedData) {
        console.log(JSON.stringify(extractedData, null, 2));

        // Optionally, write to a file
        fs.writeFileSync(path.join(configTmpDir, 'extracted_people.json'), JSON.stringify(extractedData, null, 2));
        return extractedData;
    } else {
        console.log("No properties of type 'people' found.");
        return false;
    }
}

function movePreviousUser(properties, from, to, currentIds, ignoreIds) {
    if (properties[from] && properties[to]) {
        const [remaining, moved] = properties[from].people.reduce((acc, p) => {
            if (currentIds.includes(p.id) || ignoreIds.includes(p.id)) {
                acc[0].push(p);
            } else {
                acc[1].push(p);
            }
            return acc;
        }, [[], []]);

        properties[from].people = remaining;
        properties[to].people.push(...moved);
    }
}

function updateData(data, currentIds, ignoreIds) {
    if (!data || !data.properties) {
        console.log("Invalid data structure");
        return false;
    }

    const properties = data.properties;
    const primaryField = fieldsWherePrevStaffNeedsToBeRemoved[0];

    for (const field of fieldsWherePrevStaffNeedsToBeRemoved) {
        // (1) Move people from current field to "[field] (previous staff)" if not in currentIds
        movePreviousUser(properties, field, field + " (previous staff)", currentIds, ignoreIds);
    }

    // (2) Add people to primary field if in currentIds but not in other specified fields
    if (properties[primaryField]) {
        const primaryFieldIds = properties[primaryField].people.map(p => p.id);
        const existingIds = new Set(primaryFieldIds);

        // Collect IDs from all specified fields
        for (const field of fieldsWherePrevStaffNeedsToBeRemoved) {
            if (field !== primaryField && properties[field]) {
                properties[field].people.forEach(p => existingIds.add(p.id));
            }
        }

        // Add current users who are not in any of the specified fields to the primary field
        currentIds.forEach(id => {
            if (!existingIds.has(id)) {
                properties[primaryField].people.push({ id });
            }
        });
    }

    // Output the result
    console.log(JSON.stringify(data, null, 2));

    // Optionally, write to a file
    fs.writeFileSync(path.join(configTmpDir, 'updated_people.json'), JSON.stringify(data, null, 2));
    return data;
}

function adjustUsers(pageId) {
    // List of current user IDs  
    let currentEmailsObj;
    let currentEmailsObj2;
    try {
        const rawData = fs.readFileSync(path.join(configDir, 'users.json'), 'utf8');
        currentEmailsObj = JSON.parse(rawData);
        const rawData2 = fs.readFileSync(path.join(configDir, 'users-ignore.json'), 'utf8');
        currentEmailsObj2 = JSON.parse(rawData2);
    } catch (error) {
        console.error("Error reading users.json:", error);
        process.exit(1);
    }

    const currentIds = Object.values(currentEmailsObj);
    const ignoreIds = Object.values(currentEmailsObj2)

    const extractedData = getData(pageId);
    if (extractedData) {
        const updatedData = updateData(extractedData, currentIds, ignoreIds);
        // Save updatedData to file:
        fs.writeFileSync(path.join(configTmpDir, 'updated_data.json'), JSON.stringify(updatedData.properties, null, 2));
        console.log('Updated data saved to updated_data.json');

        executeNotionCli('update --data updated_data.json', pageId);
    }
}
// Read page IDs from command line arguments
const pageIds = process.argv.slice(2);

// Iterate through each page ID
pageIds.forEach(pageId => {
    console.log(`Processing page ID: ${pageId}`);
    adjustUsers(pageId);
});