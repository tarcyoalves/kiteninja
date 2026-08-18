import { neon } from '@neondatabase/serverless';
import { loadEnv } from './load-env';
import { INITIAL_SPOTS } from '../data/mockSpots';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(url);

async function main() {
  console.log(`Syncing ${INITIAL_SPOTS.length} spots to database...`);
  for (const spot of INITIAL_SPOTS) {
    await sql`
      INSERT INTO spots (
        id, name, location, state, country, country_flag, lat, lng,
        wind_safety, water_condition, bottom_type, difficulty,
        ideal_wind_directions, hazards, amenities,
        webcam_url, webcam_live_stream, cover_image
      ) VALUES (
        ${spot.id}, ${spot.name}, ${spot.location}, ${spot.state},
        ${spot.country}, ${spot.countryFlag}, ${spot.lat}, ${spot.lng},
        ${spot.windSafety}, ${spot.waterCondition}, ${spot.bottomType},
        ${spot.difficulty}, ${spot.idealWindDirections}, ${spot.hazards},
        ${spot.amenities}, ${spot.webcamUrl ?? null},
        ${spot.webcamLiveStream ?? false}, ${spot.coverImage}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        state = EXCLUDED.state,
        wind_safety = EXCLUDED.wind_safety,
        water_condition = EXCLUDED.water_condition,
        bottom_type = EXCLUDED.bottom_type,
        difficulty = EXCLUDED.difficulty,
        ideal_wind_directions = EXCLUDED.ideal_wind_directions,
        hazards = EXCLUDED.hazards,
        amenities = EXCLUDED.amenities,
        webcam_url = EXCLUDED.webcam_url,
        webcam_live_stream = EXCLUDED.webcam_live_stream,
        cover_image = EXCLUDED.cover_image
    `;
  }
  const rows = await sql`SELECT count(*) as count FROM spots`;
  console.log('Spots synced successfully! Total in DB:', rows[0].count);
}

main().catch(console.error);
