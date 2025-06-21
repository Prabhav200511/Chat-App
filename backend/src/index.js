import dotenv from "dotenv";
dotenv.config();

import cookieParser from "cookie-parser"
import express from "express";
import authRoutes from "./routes/auth.routes.js"
import {connectDB} from "./lib/db.js"
import messageRoutes from "./routes/message.routes.js";
import cors from "cors";
import { app, server } from "./lib/socket.js";
import path from "path";

const __dirname = path.resolve(); 


app.use(express.json());
app.use(cookieParser())
app.use(cors({
    origin: "http://localhost:5173",
    credentials:true
}
));
app.use("/app/auth",authRoutes);
app.use("/app/messages",messageRoutes);

if(process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "../frontend/dist")));

    app.get("/{*any}", (req, res) => {
        res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
    });
}

console.log("\n=== Registered Express Routes ===");
app._router.stack
  .filter(r => r.route && r.route.path)
  .forEach(r => {
    const methods = Object.keys(r.route.methods).join(", ").toUpperCase();
    console.log(`${methods.padEnd(8)} ${r.route.path}`);
  });
console.log("==================================\n");



const PORT = process.env.PORT||5000

server.listen(PORT,() => {
    console.log(`app working on ${PORT}`)
    connectDB();
})


