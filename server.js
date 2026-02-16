const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const KEKA_API =
    "https://triveniglobalsoft.keka.com/k/attendance/api/mytime/attendance/summary";

app.post("/attendance", async (req, res) => {
    try {
        const token = req.body.token;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

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

        const todayStr = new Date(
            Date.now() + 5.5 * 60 * 60 * 1000
        ).toISOString().split("T")[0];

        const todayAttendance = allDays.find((day) =>
            day.attendanceDate?.includes(todayStr)
        );

        if (!todayAttendance) {
            return res.json({ error: "No attendance record found for today." });
        }

        const requiredMs =
            (todayAttendance.shiftEffectiveDuration || 8) * 60 * 60 * 1000;

        // ✅ USE timeEntries
        const entries =
            todayAttendance.timeEntries ||
            todayAttendance.originalTimeEntries ||
            [];

        // sort by timestamp
        entries.sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        let pairs = [];
        let currentIn = null;

        entries.forEach((entry) => {
            const status = entry.punchStatus;
            const time = entry.timestamp;

            if (status === 0) {
                // IN
                currentIn = {
                    inTime: time,
                    outTime: null,
                    location: entry.premiseName || "Surat-414",
                };
                pairs.push(currentIn);
            }

            if (status === 1 && currentIn) {
                // OUT
                currentIn.outTime = time;
                currentIn = null;
            }
        });

        let completedMs = 0;
        let lastInTimeMs = null;

        const formatTime = (time) => {
            if (!time) return null;
            return new Date(time).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            });
        };

        const inOutList = pairs.map((pair) => ({
            in: formatTime(pair.inTime),
            out: formatTime(pair.outTime),
            isMissing: !pair.outTime,
            location: pair.location,
        }));

        pairs.forEach((pair) => {
            if (pair.inTime) {
                const inT = new Date(pair.inTime).getTime();

                if (pair.outTime) {
                    completedMs += new Date(pair.outTime).getTime() - inT;
                } else {
                    lastInTimeMs = inT;
                }
            }
        });

        const now = Date.now();
        let runningMs = lastInTimeMs ? now - lastInTimeMs : 0;

        const totalWorkedMs = completedMs + runningMs;
        const remainingMs = Math.max(requiredMs - totalWorkedMs, 0);

        function formatMs(ms) {
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            return `${h}h ${m}m`;
        }

        const leaveTimeResult =
            remainingMs === 0
                ? new Date().toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                })
                : new Date(now + remainingMs).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                });

        res.json({
            worked: formatMs(totalWorkedMs),
            remaining: formatMs(remainingMs),
            leaveTime: leaveTimeResult,
            inOutList,
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () =>
    console.log("Server running at http://localhost:3000")
);
