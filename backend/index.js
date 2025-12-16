import express from "express";
import cors from "cors";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
import fs from "fs";
import ImageKit from "imagekit";

// Models
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";

// Clerk
import { clerkMiddleware, requireAuth } from "@clerk/express";

// Configurations
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// Constants
const DOCUMENTS_DIR = path.join(__dirname, "documents");
const VECTOR_STORE_PATH = path.join(__dirname, "faiss-store");
const EMBEDDING_MODEL = "nomic-embed-text";
const LLM_MODEL = "mistral";

// App Setup
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(clerkMiddleware());

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
};

// ImageKit
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

// ================== Core Functions ================== //

async function processDocuments() {
  try {
    const files = fs.readdirSync(DOCUMENTS_DIR);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    let docs = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(DOCUMENTS_DIR, file), "utf-8");
      const splitDocs = await splitter.splitDocuments([
        new Document({
          pageContent: content,
          metadata: { 
            source: file,
            type: "regulation"
          },
        })
      ]);
      docs.push(...splitDocs);
    }

    const embeddings = new OllamaEmbeddings({
      model: EMBEDDING_MODEL,
      baseUrl: "http://localhost:11434",
    });

    const vectorStore = await FaissStore.fromDocuments(docs, embeddings);
    await vectorStore.save(VECTOR_STORE_PATH);
    console.log("✅ Documents processed and stored");

  } catch (error) {
    console.error("Document processing failed:", error);
    throw error;
  }
}

// ================== API Endpoints ================== //

// Existing routes
app.get("/api/upload", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
});

app.get("/api/userchats", requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  try {
    const userChats = await UserChats.find({ userId });
    res.status(200).send(userChats[0]?.chats || []);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching user chats.");
  }
});

app.get("/api/chats/:id", requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });
    res.status(200).send(chat);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching chat.");
  }
});

app.post("/api/chats", requireAuth, async (req, res) => {
  const { userId, text } = req.body;
  try {
    const newChat = new Chat({
      userId,
      history: [{ role: "user", parts: [{ text }] }],
    });
    const savedChat = await newChat.save();

    const userChats = await UserChats.find({ userId });
    if (!userChats.length) {
      await new UserChats({
        userId,
        chats: [{ _id: savedChat._id, title: text.substring(0, 40) }],
      }).save();
    } else {
      await UserChats.updateOne(
        { userId },
        { $push: { chats: { _id: savedChat._id, title: text.substring(0, 40) } } }
      );
    }

    res.status(201).send(savedChat._id);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating chat.");
  }
});

app.put("/api/chats/:id", requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { question, answer, img } = req.body;

  const newItems = [
    ...(question ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }] : []),
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      { $push: { history: { $each: newItems } } }
    );
    res.status(200).send(updatedChat);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating chat.");
  }
});

// Document processing endpoints
app.post("/api/ingest", async (req, res) => {
  try {
    await processDocuments();
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents", async (req, res) => {
  try {
    const files = fs.readdirSync(DOCUMENTS_DIR);
    res.json(files.filter(file => file.endsWith('.txt')));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Document-based chat endpoint
app.post("/api/chat", async (req, res) => {
  const { question, selectedDocs } = req.body;

  try {
    const embeddings = new OllamaEmbeddings({
      model: EMBEDDING_MODEL,
      baseUrl: "http://localhost:11434",
    });
    const vectorStore = await FaissStore.load(VECTOR_STORE_PATH, embeddings);

    const results = await vectorStore.similaritySearch(question, 5, {
      source: { $in: selectedDocs }
    });

    const context = results.map(r => `[From ${r.metadata.source}]: ${r.pageContent}`).join("\n\n");
    const llm = new ChatOllama({ model: LLM_MODEL });
    
    const response = await llm.invoke(`
      As a regulatory compliance assistant, answer strictly based on:
      ${context}
      
      Question: ${question}
      Provide concise answers and cite sources:
    `);

    res.json({ 
      response: response.content,
      sources: [...new Set(results.map(r => r.metadata.source))]
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

// General chat endpoint
app.post("/api/general-chat", async (req, res) => {
  const { question } = req.body;
  
  try {
    const llm = new ChatOllama({ model: LLM_MODEL });
    const response = await llm.invoke(`
      You are a helpful assistant. Answer the following question:
      ${question}
    `);
    
    res.json({ 
      response: response.content,
      sources: []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(401).send("Unauthenticated!");
  next();
});

// ================== Server Start ================== //

async function startServer() {
  await connectDB();
  
  if (!fs.existsSync(DOCUMENTS_DIR)) fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  if (!fs.existsSync(VECTOR_STORE_PATH)) fs.mkdirSync(VECTOR_STORE_PATH, { recursive: true });

  app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
  });
}

startServer();