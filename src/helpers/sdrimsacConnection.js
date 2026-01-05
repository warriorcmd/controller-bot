import { io as ioClient } from "socket.io-client";

// URL del servicio sdrimsacbot
const SDRIMSAC_BOT_URL = process.env.SDRIMSAC_BOT_URL || "https://sdrimsac.xyz";

let sdrimsacSocket = null;
let isConnected = false;

/**
 * Inicializar conexión a sdrimsacbot
 */
export const initSdrimsacConnection = () => {
    try {
        sdrimsacSocket = ioClient(SDRIMSAC_BOT_URL, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            transports: ['websocket', 'polling']
        });

        sdrimsacSocket.on("connect", () => {
            isConnected = true;
            console.log("✅ Conectado a sdrimsacbot en", SDRIMSAC_BOT_URL);
        });

        sdrimsacSocket.on("disconnect", () => {
            isConnected = false;
            console.log("❌ Desconectado de sdrimsacbot");
        });

        sdrimsacSocket.on("connect_error", (error) => {
            console.error("⚠️ Error de conexión a sdrimsacbot:", error.message);
        });

    } catch (error) {
        console.error("❌ Error al inicializar conexión a sdrimsacbot:", error.message);
    }
};

/**
 * Enviar evento a sdrimsacbot
 * @param {string} event - Nombre del evento
 * @param {object} data - Datos a enviar
 */
export const emitToSdrimsac = (event, data) => {
    if (sdrimsacSocket && isConnected) {
        sdrimsacSocket.emit(event, data);
        console.log(`📤 Evento enviado a sdrimsacbot:`, event, data);
        return true;
    } else {
        console.warn(`⚠️ No conectado a sdrimsacbot para emitir: ${event}`);
        return false;
    }
};

/**
 * Escuchar eventos desde sdrimsacbot
 * @param {string} event - Nombre del evento
 * @param {function} callback - Función callback
 */
export const onSdrimsacEvent = (event, callback) => {
    if (sdrimsacSocket) {
        sdrimsacSocket.on(event, callback);
    }
};

/**
 * Obtener estado de conexión
 */
export const isSdrimsacConnected = () => isConnected;

/**
 * Cerrar conexión a sdrimsacbot
 */
export const closeSdrimsacConnection = () => {
    if (sdrimsacSocket) {
        sdrimsacSocket.disconnect();
        isConnected = false;
        console.log("🔌 Conexión a sdrimsacbot cerrada");
    }
};
