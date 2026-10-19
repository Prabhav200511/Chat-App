import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { createApp } from "./app.js";
import { initSocket } from "./lib/socket.js";
import { connectDB } from "./lib/db.js";

// Default matches the frontend's dev target (localhost:4000)
const PORT = process.env.PORT || 4000;

const app = createApp();
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
    console.log(`app working on ${PORT}`);
    connectDB();
});
