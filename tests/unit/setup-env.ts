process.env.MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017";
