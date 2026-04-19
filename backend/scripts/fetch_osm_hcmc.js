const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getQuery, HCMC_BBOX, OVERPASS_URL } = require('./overpass_queries');

async function fetchOSMData() {
    const query = getQuery(HCMC_BBOX);
    
    console.log("Fetching OSM data for HCMC... This might take a minute.");
    
    try {
        const response = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const outPath = path.join(dataDir, 'raw_hcmc_osm.json');
        fs.writeFileSync(outPath, JSON.stringify(response.data, null, 2));
        
        console.log(`Successfully fetched ${response.data.elements.length} elements!`);
        console.log(`Data saved to: ${outPath}`);
    } catch (error) {
        console.error("Error fetching data from Overpass API:", error.message);
        if (error.response) {
            console.error("Response:", error.response.data);
        }
    }
}

fetchOSMData();
