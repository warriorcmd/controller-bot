
import express from "express";
import multer from "multer";
import fileUpload from "express-fileupload";
import path from "path";
import { fileURLToPath } from "url";
import { startBot } from "./helpers/startBot.js"
import { botState, getTenantState } from "./helpers/botState.js";
import http from "http";
import { Server as IOServer } from "socket.io";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { 
    setSocket, 
    sendNormalMessage, 
    sendMedia, 
    sendToGroup, 
    getChats, 
    showChats, 
    sendFileToChat, 
    sendToChat,
    getQueueStats,
    setQueueDelay,
    setQueuePreset,
    setHumanPattern,
    clearQueue,
    deleteSession,
    getSocketForTenant,
    attachDashboardToTenant
} from "./controllers/messageController.js";

const upload = multer({ dest: "uploads/" });
const app = express();
app.use(fileUpload());
app.use(express.json());
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "ui")));
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ============================================================
// ENDPOINT - ESTADO DE LA CONEXIÓN
// ============================================================
app.get("/status", (req, res) => {
    const tenantId = req.query?.tenantId;
    const uptime = Math.floor((new Date() - botState.botInfo.startTime) / 1000);
    const uptimeFormatted = formatUptime(uptime);

    if (tenantId) {
        const tstate = getTenantState(tenantId);
        return res.json({
            tenantId,
            authenticated: tstate?.isAuthenticated || false,
            connectionStatus: tstate?.connectionStatus || 'disconnected',
            uptime: uptime,
            uptimeFormatted: uptimeFormatted,
            messageStats: botState.messageStats,
            phoneNumber: tstate?.botInfo?.phoneNumber || null,
            timestamp: new Date().toISOString()
        });
    }

    res.json({
        authenticated: false,
        connectionStatus: 'unknown',
        uptime: uptime,
        uptimeFormatted: uptimeFormatted,
        messageStats: botState.messageStats,
        phoneNumber: null,
        timestamp: new Date().toISOString()
    });
});

// Enviar mensaje normal (texto)
app.post("/api/send-messages", sendNormalMessage);

// Enviar archivo/media
app.post("/api/send-medias", sendMedia);

// Enviar mensaje a grupo por JID
app.post("/api/send-group", sendToGroup);

// Obtener lista de chats
app.get("/api/chats", getChats);

// Mostrar chats con nombres
app.get("/api/show-chats", showChats);

// Enviar archivo a chat por nombre
app.post("/api/send-file-chat", sendFileToChat);

// Enviar mensaje a chat por nombre
app.post("/api/send-to-chat", sendToChat);

app.get("/api/queue/stats", getQueueStats);

// Configurar delay entre mensajes (en milisegundos) - LEGACY
app.post("/api/queue/set-delay", setQueueDelay);

// Configurar preset de delay dinámico (NUEVO - RECOMENDADO)
app.post("/api/queue/set-preset", setQueuePreset);

// Activar/desactivar patrón humano (NUEVO)
app.post("/api/queue/set-human-pattern", setHumanPattern);

// Limpiar cola de mensajes pendientes
app.post("/api/queue/clear", clearQueue);

app.post("/api/session/delete", deleteSession);

const PORT = botState.PORT;
const server = http.createServer(app);
const io = new IOServer(server, { 
    cors: { origin: "*" },
    transports: ["websocket", "polling"]
});

io.on("connection", (socket) => {
    console.log("🔌 Dashboard client connected", socket.id);
    socket.on("start-session", ({ tenantId }) => {
        if (!tenantId) tenantId = "default";
        console.log(`🔰 start-session request for tenant: ${tenantId} from socket ${socket.id}`);
        const existing = getSocketForTenant(tenantId);
        if (existing) {
            console.log(`🔁 Ya existe sesión para ${tenantId}, adjuntando dashboard socket ${socket.id}`);
            attachDashboardToTenant(tenantId, socket);
        } else {
            startBot(tenantId, socket);
        }
    });
    socket.on("join", ({ tenantId }) => {
        if (!tenantId) tenantId = "default";
        socket.join(tenantId);
    });

    socket.on("disconnect", () => {
        console.log("🔌 Dashboard client disconnected", socket.id);
    });
});

server.listen(PORT, () => {
    console.log("");
    console.log("╔════════════════════════════════════════╗");
    console.log("║  🌐 SERVIDOR EXPRESS INICIADO         ║");
    console.log("╚════════════════════════════════════════╝");
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📊 Dashboard disponible`);
    console.log(`📡 API REST lista`);
    console.log("");
    startBot();
});
