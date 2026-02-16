const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

// ✅ Force IST
const SERVER_TIMEZONE = "Asia/Kolkata";

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const KEKA_API =
    "https://triveniglobalsoft.keka.com/k/attendance/api/mytime/attendance/summary";


// ✅ Format seconds to HH:mm:ss
function formatSeconds(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return `${hrs}h ${mins}m ${secs}s`;
}


app.post("/attendance", async (req, res) => {
    try {
        const token = req.body.token;
        const productiveHoursInput = req.body.productiveHours;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        if (!productiveHoursInput || isNaN(productiveHoursInput)) {
            return res.status(400).json({ error: "Valid productive hours required" });
        }

        // ✅ Convert productive hours → seconds
        const productiveHours = Number(productiveHoursInput);
        const targetSeconds = Math.floor(productiveHours * 60 * 60);

        const response = await fetch(KEKA_API, {
            method: "GET",
            headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({
                error: "Keka API Error",
                details: errorText,
            });
        }

        const result = await response.json();
        const allDays = result.data || [];

        const todayStr = dayjs().tz(SERVER_TIMEZONE).format("YYYY-MM-DD");

        const todayAttendance = allDays.find((day) =>
            day.attendanceDate?.includes(todayStr)
        );

        if (!todayAttendance) {
            return res.json({ error: "No attendance record found for today." });
        }

        const entries =
            todayAttendance.timeEntries ||
            todayAttendance.originalTimeEntries ||
            [];

        entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        let pairs = [];
        let currentIn = null;

        entries.forEach((entry) => {
            if (entry.punchStatus === 0) {
                currentIn = {
                    inTime: entry.timestamp,
                    outTime: null,
                    location: entry.premiseName || "Office",
                };
                pairs.push(currentIn);
            }

            if (entry.punchStatus === 1 && currentIn) {
                currentIn.outTime = entry.timestamp;
                currentIn = null;
            }
        });

        let totalWorkedSeconds = 0;
        let lastInTime = null;

        pairs.forEach((pair) => {
            const inTime = dayjs(pair.inTime).tz(SERVER_TIMEZONE);

            if (pair.outTime) {
                const outTime = dayjs(pair.outTime).tz(SERVER_TIMEZONE);
                totalWorkedSeconds += outTime.diff(inTime, "second");
            } else {
                lastInTime = inTime;
            }
        });

        // ✅ If currently punched IN → include running time
        if (lastInTime) {
            const now = dayjs().tz(SERVER_TIMEZONE);
            totalWorkedSeconds += now.diff(lastInTime, "second");
        }

        const remainingSeconds = Math.max(
            targetSeconds - totalWorkedSeconds,
            0
        );

        // ✅ Leave time with seconds
        let leaveTime;

        if (remainingSeconds === 0) {
            leaveTime = dayjs()
                .tz(SERVER_TIMEZONE)
                .format("hh:mm:ss A");
        } else {
            leaveTime = dayjs()
                .tz(SERVER_TIMEZONE)
                .add(remainingSeconds, "second")
                .format("hh:mm:ss A");
        }

        const inOutList = pairs.map((pair) => ({
            in: pair.inTime
                ? dayjs(pair.inTime).tz(SERVER_TIMEZONE).format("hh:mm:ss A")
                : null,
            out: pair.outTime
                ? dayjs(pair.outTime).tz(SERVER_TIMEZONE).format("hh:mm:ss A")
                : null,
            isMissing: !pair.outTime,
            location: pair.location,
        }));

        res.json({
            timezone: SERVER_TIMEZONE,
            worked: formatSeconds(totalWorkedSeconds),
            remaining: formatSeconds(remainingSeconds),
            leaveTime,
            inOutList,
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
    console.log("Timezone fixed to:", SERVER_TIMEZONE);
});
