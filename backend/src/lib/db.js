import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        mongoose.connect(process.env.MONGO_URL, {})
            .then(() => {
                console.log("Mongo connected");
            })
            .catch((error) => {
                console.log(error);
            });
    } catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1);
    }
}