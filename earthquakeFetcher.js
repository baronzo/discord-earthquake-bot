import axios from "axios";

const USGS_API_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

// State variables (Should be kept in memory if running a long-lived process)
let sentAlerts = new Set();
let lastEtag = null; // เก็บ ETag ล่าสุด

export async function fetchEarthquakes() {
    const alerts = [];

    try {
        // Config เพื่อเช็คว่าข้อมูลเปลี่ยนไหม
        const config = {
            headers: {},
            validateStatus: function (status) {
                return status >= 200 && status < 300 || status === 304; // ยอมรับ 304 ว่าไม่ error
            }
        };

        if (lastEtag) {
            config.headers['If-None-Match'] = lastEtag;
        }

        const response = await axios.get(USGS_API_URL, config);

        // กรณี 304: ข้อมูลเหมือนเดิม ไม่ต้องทำอะไร
        if (response.status === 304) {
            // console.log("No new updates (304 Not Modified)");
            return [];
        }

        // อัปเดต ETag ใหม่สำหรับการยิงครั้งหน้า
        if (response.headers['etag']) {
            lastEtag = response.headers['etag'];
        }

        const features = response.data.features;

        // --- Memory Cleanup Strategy ---
        // สร้าง Set ของ ID ที่อยู่ใน Feed ปัจจุบัน (1 ชั่วโมงล่าสุด)
        const currentFeedIds = new Set(features.map(f => f.id));

        // ลบ ID ใน sentAlerts ที่ไม่อยู่ใน Feed ปัจจุบันแล้ว (เก่าเกิน 1 ชม.)
        // เพื่อป้องกัน Memory Leak
        for (const id of sentAlerts) {
            if (!currentFeedIds.has(id)) {
                sentAlerts.delete(id);
            }
        }
        // -------------------------------

        for (const feature of features) {
            const id = feature.id;

            // ถ้าเคยส่งแล้ว ข้ามเลย
            if (sentAlerts.has(id)) continue;

            const props = feature.properties;
            const geometry = feature.geometry;
            const mag = props.mag;
            const place = props.place || "Unknown Location";
            const coordinates = geometry.coordinates; // [lon, lat, depth]
            const lon = coordinates[0];
            const lat = coordinates[1];

            // Filter Logic
            const isGlobalMajor = mag > 5.0;

            // Thailand Filter
            const isInsideThailandBox = (lat >= 5.6 && lat <= 20.5) && (lon >= 97.3 && lon <= 105.7);
            const isThailandByName = place.toLowerCase().includes("thailand");
            const isThailand = isInsideThailandBox || isThailandByName;

            if (isGlobalMajor || isThailand) {
                alerts.push({
                    id: id,
                    title: props.title,
                    mag: mag,
                    place: place,
                    time: new Date(props.time),
                    url: props.url,
                    isThailand: isThailand,
                    coordinates: { lat, lon } // เพิ่มพิกัดเผื่อใช้ปักหมุด
                });

                sentAlerts.add(id);
            }
        }

    } catch (error) {
        console.error("Error fetching earthquake data:", error.message);
        // Reset ETag on error to force full fetch next time
        lastEtag = null;
    }

    return alerts;
}