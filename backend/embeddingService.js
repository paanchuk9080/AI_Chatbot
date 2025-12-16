import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
import { Document } from "langchain/document";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VECTOR_STORE_PATH = path.join(__dirname, "faiss-store");
const DOCUMENTS_DIR = path.join(__dirname, "documents");

async function embedDocs() {
  try {
    console.log("Starting document processing with FAISS...");

    // Load and process documents
    const files = fs.readdirSync(DOCUMENTS_DIR);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });

    let docs = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(DOCUMENTS_DIR, file), "utf-8");
      docs.push(...await splitter.splitDocuments([
        new Document({ pageContent: content, metadata: { source: file } })
      ]));
    }

    // Create and save vector store
    const vectorStore = await FaissStore.fromDocuments(
      docs,
      new OllamaEmbeddings({ model:  "nomic-embed-text" })
    );
    await vectorStore.save(VECTOR_STORE_PATH);

    console.log(` Success! FAISS store saved to ${VECTOR_STORE_PATH}`);

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

embedDocs();