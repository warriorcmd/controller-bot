import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { botState, setTenantState } from "./botState.js";
import { setSocket } from "../controllers/messageController.js";

/**
 * Inicia una sesión de Baileys para un tenant específico.
 * @param {string} tenantId Identificador del tenant (se usa como carpeta bajo ./session)
 * @param {object} dashboardSocket Socket.IO client socket para emitir QR/estado (opcional)
 */
export async function startBot(tenantId = "default", dashboardSocket = null) {
    try {
        console.log(`🔄 Cargando Baileys para tenant: ${tenantId}...`);

        const sessionDir = `./session/${tenantId}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        console.log(`✅ Baileys v${version.join(".")} cargado`);

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            markOnlineOnConnect: true
        });

        // Registrar socket en el controlador por tenant
        setSocket(tenantId, sock);

        // Guardar referencia en el estado del tenant para que dashboards
        // puedan consultarlo sin pisar otros tenants
        try {
            setTenantState(tenantId, { sock });
        } catch (e) {
            // no crítico
        }

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`📱 Generando código QR para tenant ${tenantId}...`);
                const start = Date.now();
                try {
                    const dataUrl = await QRCode.toDataURL(qr, botState.qrOptions);
                    console.log(`✅ QR generado en ${Date.now() - start}ms`);
                    // Guardar QR generado en estado global para que otros sockets
                    // (dashboard) puedan solicitarlo/recibirlo al conectarse
                    // Guardar QR en el estado del tenant
                    setTenantState(tenantId, { qrCode: dataUrl });
                    // Emitir por socket al dashboard si está conectado
                    if (dashboardSocket) {
                        dashboardSocket.emit("qr", { tenantId, qr: dataUrl });
                    }
                } catch (err) {
                    console.error("❌ Error al generar QR:", err);
                }
            }

            if (connection === "connecting") {
                console.log(`🔗 [${tenantId}] Conectando con WhatsApp...`);
                if (dashboardSocket) dashboardSocket.emit("status", { tenantId, status: "connecting" });
            }

            if (connection === "open") {
                console.log(`✅ [${tenantId}] BOT CONECTADO`);
                if (sock.user) {
                    const phoneNumber = sock.user.id.split(":")[0];
                    if (dashboardSocket) dashboardSocket.emit("connected", { tenantId, phoneNumber });
                    setTenantState(tenantId, { botInfo: { phoneNumber } });
                }
                if (dashboardSocket) dashboardSocket.emit("status", { tenantId, status: "connected" });
                setTenantState(tenantId, { isAuthenticated: true, connectionStatus: 'connected' });
            }

            if (connection === "close") {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                console.log(`❌ [${tenantId}] Conexión cerrada`);
                if (dashboardSocket) dashboardSocket.emit("status", { tenantId, status: "disconnected" });
                setTenantState(tenantId, { isAuthenticated: false, connectionStatus: 'disconnected' });
                if (shouldReconnect) {
                    console.log(`🔄 [${tenantId}] Reintentando en 3 segundos...`);
                    setTimeout(() => startBot(tenantId, dashboardSocket), 3000);
                } else {
                    console.log(`⚠️  [${tenantId}] Sesión eliminada - Escanea nuevo QR`);
                    if (dashboardSocket) dashboardSocket.emit("session-deleted", { tenantId });
                }
            }
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("messages.upsert", async (m) => {
            const message = m.messages[0];
            if (!message.key.fromMe && message.message) {
                botState.messageStats.received++;
                const from = message.key.remoteJid;
                const text = message.message.conversation || message.message.extendedTextMessage?.text || "[Multimedia]";
                console.log(`📨 [${tenantId}] ${from}: ${text}`);
            }
        });

        return sock;

    } catch (error) {
        console.error("❌ Error crítico al iniciar bot:", error);
        console.log("🔄 Reintentando en 5 segundos...");
        setTimeout(() => startBot(tenantId, dashboardSocket), 5000);
    }
}

