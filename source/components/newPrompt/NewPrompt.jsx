import { useEffect, useRef, useState } from "react";
import "./newPrompt.css";
import Upload from "../upload/Upload";
import { IKImage } from "imagekitio-react";
import Markdown from "react-markdown";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const NewPrompt = ({ data }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [img, setImg] = useState({
    isLoading: false,
    error: "",
    dbData: {},
    aiData: {},
  });
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [availableDocs, setAvailableDocs] = useState([]);
  const [chatMode, setChatMode] = useState("general");

  const endRef = useRef(null);
  const formRef = useRef(null);
  const queryClient = useQueryClient();

  // Initialize messages from data
  useEffect(() => {
    if (data?.history) {
      const initialMessages = data.history.flatMap(item => {
        if (item.role === "user") {
          return {
            type: "user",
            content: item.parts[0].text,
            img: item.img
          };
        } else if (item.role === "model") {
          return {
            type: "assistant",
            content: item.parts[0].text,
            sources: item.sources ? item.sources.split(", ") : []
          };
        }
        return [];
      });
      setMessages(initialMessages);
    }
  }, [data]);

  // Fetch available documents
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/documents`);
        const docs = await response.json();
        setAvailableDocs(docs);
        setSelectedDocs(docs);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
      }
    };
    fetchDocuments();
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const mutation = useMutation({
    mutationFn: (chatData) => {
      return fetch(`${import.meta.env.VITE_API_URL}/api/chats/${data._id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...chatData,
          sources: chatData.sources?.join(", ") || "",
          img: img.dbData?.filePath || undefined
        }),
      }).then((res) => res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", data._id] });
    },
  });

  const sendMessage = async (message) => {
    // Add user message
    const newMessages = [...messages, { type: "user", content: message }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const endpoint = chatMode === "regulations" ? "/api/chat" : "/api/general-chat";
      const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: message,
          ...(chatMode === "regulations" && { selectedDocs }),
          ...(chatMode === "general" && { 
            image: img.dbData?.filePath ? {
              url: `${import.meta.env.VITE_IMAGE_KIT_ENDPOINT}/${img.dbData.filePath}`,
              caption: img.aiData?.caption
            } : null
          })
        }),
      });

      if (!response.ok) throw new Error("Failed to get response");
      
      const { response: answerText, sources } = await response.json();
      
      // Add assistant response
      setMessages([...newMessages, { 
        type: "assistant", 
        content: answerText,
        sources 
      }]);

      mutation.mutate({
        question: message,
        answer: answerText,
        sources: sources || []
      });

    } catch (err) {
      setMessages([...messages, { 
        type: "assistant", 
        content: `Error: ${err.message}`,
        error: true 
      }]);
      console.error("Chat error:", err);
    } finally {
      setIsLoading(false);
      if (chatMode === "general") {
        setImg({ isLoading: false, error: "", dbData: {}, aiData: {} });
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const message = inputMessage.trim();
    if (!message) return;
    sendMessage(message);
    setInputMessage("");
  };

  const toggleMode = (mode) => {
    setChatMode(mode);
    if (mode === "regulations") {
      setImg({ isLoading: false, error: "", dbData: {}, aiData: {} });
    }
  };

  const toggleDocument = (docName) => {
    setSelectedDocs(prev => 
      prev.includes(docName)
        ? prev.filter(d => d !== docName)
        : [...prev, docName]
    );
  };

  return (
    <>
      {/* Mode Selector - unchanged */}
      <div className="mode-selector">
        <button
          className={chatMode === "general" ? "active" : ""}
          onClick={() => toggleMode("general")}
        >
          General Chat
        </button>
        <button
          className={chatMode === "regulations" ? "active" : ""}
          onClick={() => toggleMode("regulations")}
        >
          Regulations Mode
        </button>
      </div>

      {/* Document Selection - unchanged */}
      {chatMode === "regulations" && (
        <div className="document-selector">
          <h4>Select Regulations:</h4>
          {availableDocs.map(doc => (
            <label key={doc} className="document-checkbox">
              <input
                type="checkbox"
                checked={selectedDocs.includes(doc)}
                onChange={() => toggleDocument(doc)}
              />
              {doc.replace('.txt', '')}
            </label>
          ))}
        </div>
      )}

      {/* Image Preview - unchanged */}
      {img.isLoading && <div>Loading image...</div>}
      {img.dbData?.filePath && (
        <IKImage
          urlEndpoint={import.meta.env.VITE_IMAGE_KIT_ENDPOINT}
          path={img.dbData?.filePath}
          width="380"
          transformation={[{ width: 380 }]}
        />
      )}

      {/* Chat Messages - modified to show history */}
      {messages.map((msg, index) => (
        <div key={index} className={`message ${msg.type} ${msg.error ? "error" : ""}`}>
          {msg.type === "assistant" ? (
            <>
              <Markdown>{msg.content}</Markdown>
              {msg.sources && msg.sources.length > 0 && (
                <div className="sources">
                  <small>Sources: {msg.sources.join(", ")}</small>
                </div>
              )}
            </>
          ) : (
            msg.content
          )}
        </div>
      ))}
      
      {isLoading && <div className="message">Processing...</div>}
      <div className="endChat" ref={endRef}></div>

      {/* Input Form - nearly unchanged */}
      <form className="newForm" onSubmit={handleSubmit} ref={formRef}>
        <Upload setImg={setImg} />
        <input id="file" type="file" multiple={false} hidden />
        <input 
          type="text" 
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ask anything..." 
          disabled={isLoading}
        />
        <button disabled={isLoading}>
          <img src="/arrow.png" alt="Send" />
        </button>
      </form>
    </>
  );
};

export default NewPrompt;