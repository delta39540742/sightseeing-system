const fs = require('fs');
const path = require('path');

/**
 * Script to transform raw Overpass OSM data into the JSON format 
 * compatible with danang_places.json and seed-places.ts
 */

// Usage: node scripts/transform_osm2json.js [city_name]
// example: node scripts/transform_osm2json.js hcmc
const city = process.argv[2] || 'hcmc';
const RAW_FILE = path.join(__dirname, '..', 'data', `raw_${city}_osm.json`);
const OUT_FILE = path.join(__dirname, '..', `places_${city}.json`);

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFloat(min, max, decimals = 1) {
    const val = Math.random() * (max - min) + min;
    return parseFloat(val.toFixed(decimals));
}

function processElements(elements) {
    const results = [];
    const cityName = city === 'hcmc' ? 'Ho Chi Minh City' : (city === 'khanh_hoa' ? 'Nha Trang' : (city === 'an_giang' ? 'An Giang' : (city === 'vung_tau' ? 'Vung Tau' : (city === 'bac_giang' ? 'Bac Giang' : 'Da Nang'))));

    elements.forEach(el => {
        if (!el.tags || !el.tags.name) return;

        // 1. Basic Info
        const id = `osm_${el.id}`;
        const name = el.tags.name;
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);
        if (!lat || !lng) return;

        // 2. Category Mapping
        let category = 'other';
        const foodAmenities = ['restaurant', 'cafe', 'food_court', 'fast_food', 'bar', 'pub'];
        const tourismTags = ['museum', 'attraction', 'viewpoint', 'zoo', 'theme_park', 'gallery'];

        if (el.tags.amenity && foodAmenities.includes(el.tags.amenity)) {
            category = el.tags.amenity === 'cafe' ? 'cafe' : 'restaurant';
        } else if (el.tags.tourism || el.tags.historic) {
            category = 'attraction';
        } else if (el.tags.leisure && ['park', 'water_park'].includes(el.tags.leisure)) {
            category = 'attraction';
        }

        // 3. Tags
        const tags = [];
        if (category === 'restaurant' || category === 'cafe') {
            tags.push('food');
            if (el.tags.cuisine) tags.push('local_food');
        } else if (category === 'attraction') {
            tags.push('tourism');
            if (el.tags.historic) tags.push('culture');
            if (el.tags.leisure === 'park') tags.push('nature');
        }

        // 4. Prices & Costs (Simulated)
        let price_min = 0;
        let price_max = 0;
        if (category === 'restaurant' || category === 'cafe') {
            price_min = 30000;
            price_max = 200000;
        } else if (category === 'attraction') {
            price_min = 0;
            price_max = 150000;
        }
        const visit_cost = getRandomInt(price_min, price_max || 50000);

        // 5. Opening Hours
        let open = "08:00";
        let close = "22:00";
        if (el.tags.opening_hours) {
            // Very basic parser for "08:00-22:00" style strings
            const match = el.tags.opening_hours.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            if (match) {
                open = match[1];
                close = match[2];
            }
        } else if (category === 'restaurant' || category === 'cafe') {
            open = "10:00";
            close = "22:00";
        }

        // 6. Duration
        let duration_minutes = 60;
        if (category === 'restaurant') duration_minutes = 90;
        if (category === 'cafe') duration_minutes = 45;
        if (category === 'attraction') duration_minutes = 120;

        // 7. Other metadata
        const is_indoor = el.tags.indoor === 'yes' || ['restaurant', 'cafe', 'museum'].includes(el.tags.amenity || el.tags.tourism);
        const popularity = getRandomInt(10, 100);
        const rating = getRandomFloat(3.5, 4.9);
        const imageSearch = category === 'restaurant' ? 'restaurant' : (category === 'cafe' ? 'coffee' : 'vietnam travel');
        const image = `https://source.unsplash.com/400x300/?${encodeURIComponent(imageSearch)}`;

        results.push({
            id,
            name,
            lat,
            lng,
            category,
            tags,
            price_min,
            price_max,
            visit_cost,
            opening_hours: { open, close },
            duration_minutes,
            is_indoor,
            popularity,
            rating,
            image,
            address: cityName,
            created_at: new Date().toISOString()
        });
    });

    return results;
}

function main() {
    console.log(`Reading raw OSM data from: ${RAW_FILE}`);
    if (!fs.existsSync(RAW_FILE)) {
        console.error(`Error: File not found. Please run fetch_osm_${city}.js first.`);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
    if (!rawData.elements) {
        console.error("Error: No elements found in OSM data.");
        return;
    }

    console.log(`Processing ${rawData.elements.length} elements...`);
    const processedData = processElements(rawData.elements);

    fs.writeFileSync(OUT_FILE, JSON.stringify(processedData, null, 2), 'utf8');
    console.log(`Successfully generated ${processedData.length} places in: ${OUT_FILE}`);
    console.log(`This file is now compatible with danang_places.json format!`);
}

main();
