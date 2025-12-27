import fs from "fs";
import { phoneNumberFormatter } from "../helpers/formatter.js";
import messageQueue from "../helpers/messageQueue.js";

// Mapa de sockets por tenant
const socks = new Map();

export const setSocket = (tenantId, socket) => {
    if (!tenantId) tenantId = "default";
    socks.set(tenantId, socket);
};

const getTenantIdFromReq = (req) => {
    return req.headers?.["x-tenant-id"] || req.query?.tenantId || req.body?.tenantId || "default";
};

const getSockForTenant = (tenantId) => socks.get(tenantId) || null;

export const getSocketForTenant = (tenantId) => getSockForTenant(tenantId);

import { getTenantState, deleteTenantState } from "../helpers/botState.js";

/**
 * Eliminar sesión de un tenant: cerrar socket si existe, borrar carpeta de session
 * y limpiar estado del tenant. Se puede invocar desde frontend para forzar
 * recreación de la sesión (generar nuevo QR).
 */
export const deleteSession = async (req, res) => {
    try {
        const tenantId = getTenantIdFromReq(req);

        console.log(`🗑️ Solicitud para eliminar sesión del tenant: ${tenantId}`);

        // Validar tenantId simple para evitar path traversal
        if (!/^[\w-]+$/.test(tenantId)) {
            return res.status(400).json({ status: false, message: 'tenantId inválido' });
        }

        const sock = getSockForTenant(tenantId);

        // Intentar cerrar socket de forma segura
        if (sock) {
            try {
                if (typeof sock.logout === 'function') {
                    await sock.logout();
                } else if (typeof sock.close === 'function') {
                    sock.close();
                } else if (typeof sock.end === 'function') {
                    sock.end();
                }
            } catch (err) {
                console.error(`Error cerrando socket para ${tenantId}:`, err?.message || err);
            }
            socks.delete(tenantId);
        }

        // Borrar carpeta de session
        const sessionPath = `./session/${tenantId}`;
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Error borrando carpeta de sesión ${sessionPath}:`, err?.message || err);
            return res.status(500).json({ status: false, message: 'Error borrando archivos de sesión', error: err?.message || err });
        }

        // Limpiar estado en memoria
        try {
            deleteTenantState(tenantId);
        } catch (err) {
            console.error(`Error limpiando estado de tenant ${tenantId}:`, err?.message || err);
        }

        console.log(`🗑️ Sesión ${tenantId} eliminada correctamente`);
        return res.status(200).json({ status: true, message: `Sesión ${tenantId} eliminada` });

    } catch (error) {
        console.error('Error en deleteSession:', error);
        return res.status(500).json({ status: false, message: error?.message || error });
    }
};

export const attachDashboardToTenant = (tenantId, dashboardSocket) => {
    if (!tenantId) tenantId = 'default';
    const sock = getSockForTenant(tenantId);
    // Emitir estado y QR si tenemos información en el estado del tenant
    try {
        const tenantState = getTenantState(tenantId);
        if (tenantState?.qrCode) {
            dashboardSocket.emit('qr', { tenantId, qr: tenantState.qrCode });
        }
        dashboardSocket.emit('status', { tenantId, status: tenantState?.connectionStatus || 'unknown' });
        if (tenantState?.isAuthenticated) {
            dashboardSocket.emit('connected', { tenantId, phoneNumber: tenantState?.botInfo?.phoneNumber || null });
        }
    } catch (err) {
        console.error('Error emitting attachDashboard events:', err);
    }
    return sock || null;
};

// ============================================================
// OBTENER GRUPOS (CHATS)
// ============================================================
export const getChats = async (req, res) => {
    try {
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);
        if (!sock) {
            return res.status(422).json({
                status: false,
                message: "Bot no está conectado"
            });
        }

        // En Baileys, necesitas usar un store para obtener chats
        // Por ahora retornamos un mensaje indicando que necesitas implementar un store
        return res.status(200).json({
            status: true,
            message: "Para obtener chats, debes implementar @whiskeysockets/baileys/store",
            response: []
        });

    } catch (error) {
        console.error("Error en getChats:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

// ============================================================
// ENVIAR MENSAJE NORMAL (TEXTO) - CON COLA
// ============================================================
export const sendNormalMessage = async (req, res) => {
    try {
        const { number, message, tenantId: ten } = req.body;

        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);

        if (!sock) {
            return res.status(422).json({ status: false, message: "Bot no está conectado" });
        }

        if (!number || !message) {
            return res.status(400).json({
                status: false,
                message: "Faltan parámetros: number, message"
            });
        }

        // Agregar mensaje a la cola en lugar de enviar directamente
        const promise = messageQueue.addToQueue({ type: 'text', sock: sock, tenantId, number: number, message: message });

    console.log(`✅ Mensaje agregado a la cola para ${number} (tenant: ${tenantId})`);

        // No esperes el resultado: responder inmediatamente al cliente.
        // Manejar el resultado en background para logging/errores.
        promise.then(result => {
            console.log(`🔔 Mensaje procesado (background):`, result?.data || result);
        }).catch(err => {
            console.error(`❌ Error procesando mensaje en la cola (background):`, err?.message || err);
        });

        return res.status(200).json({
            status: true,
            message: "Mensaje agregado a la cola de envío",
            queueInfo: messageQueue.getQueueInfo()
        });

    } catch (error) {
        console.error("Error en sendNormalMessage:", error);
        return res.status(500).json({
            status: false,
            message: error.message,
            response: error
        });
    }
};

// ============================================================
// ENVIAR ARCHIVO/MEDIA - CON COLA
// ============================================================
export const sendMedia = async (req, res) => {
    try {
        const { number, caption } = req.body;
        const file = req.files?.file;
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);

        if (!sock) return res.status(422).json({ status: false, message: "Bot no está conectado" });

        if (!number || !file) {
            return res.status(400).json({
                status: false,
                message: "Faltan parámetros: number, file"
            });
        }

        // Agregar mensaje con archivo a la cola
        const promise = messageQueue.addToQueue({ type: 'media', sock: sock, tenantId, number: number, file: file, caption: caption || "" });

    console.log(`✅ Archivo agregado a la cola para ${number} (tenant: ${tenantId}): ${file.name}`);

        promise.then(result => {
            console.log(`🔔 Archivo procesado (background):`, result?.data || result);
        }).catch(err => {
            console.error(`❌ Error procesando archivo en la cola (background):`, err?.message || err);
        });

        return res.status(200).json({
            status: true,
            message: "Archivo agregado a la cola de envío",
            queueInfo: messageQueue.getQueueInfo()
        });

    } catch (error) {
        console.error("Error en sendMedia:", error);
        return res.status(500).json({
            status: false,
            message: error.message,
            response: error
        });
    }
};

// ============================================================
// MOSTRAR LISTA DE CHATS
// ============================================================
export const showChats = async (req, res) => {
    try {
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);
        if (!sock) return res.status(422).json({ status: false, message: "Bot no está conectado" });

        // Para obtener chats en Baileys necesitas implementar un store
        // Aquí te muestro cómo hacerlo cuando implementes el store
        return res.status(200).json({
            status: true,
            message: "Implementa makeInMemoryStore de Baileys para acceder a chats",
            response: []
        });

    } catch (error) {
        console.error("Error en showChats:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

// ============================================================
// ENVIAR ARCHIVO A UN CHAT/GRUPO POR NOMBRE
// ============================================================
export const sendFileToChat = async (req, res) => {
    try {
        const { chatName, caption } = req.body;
        const file = req.files?.file;
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);
        if (!sock) return res.status(422).json({ status: false, message: "Bot no está conectado" });

        if (!chatName || !file) {
            return res.status(400).json({
                status: false,
                message: "Faltan parámetros: chatName, file"
            });
        }

        // Nota: Para buscar chats por nombre necesitas implementar un store
        // Por ahora retornamos un mensaje de ejemplo
        return res.status(501).json({
            status: false,
            message: "Implementa makeInMemoryStore de Baileys para buscar chats por nombre"
        });

    } catch (error) {
        console.error("Error en sendFileToChat:", error);
        return res.status(500).json({
            status: false,
            message: error.message,
            response: error
        });
    }
};

// ============================================================
// ENVIAR MENSAJE A UN CHAT/GRUPO POR NOMBRE
// ============================================================
export const sendToChat = async (req, res) => {
    try {
        const { chatName, message } = req.body;
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);
        if (!sock) return res.status(422).json({ status: false, message: "Bot no está conectado" });

        if (!chatName || !message) {
            return res.status(400).json({
                status: false,
                message: "Faltan parámetros: chatName, message"
            });
        }

        // Nota: Para buscar chats por nombre necesitas implementar un store
        // Por ahora retornamos un mensaje de ejemplo
        return res.status(501).json({
            status: false,
            message: "Implementa makeInMemoryStore de Baileys para buscar chats por nombre"
        });

    } catch (error) {
        console.error("Error en sendToChat:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

// ============================================================
// ENVIAR MENSAJE A GRUPO POR JID DIRECTO - CON COLA
// ============================================================
export const sendToGroup = async (req, res) => {
    try {
        const { groupJid, message } = req.body;
        const tenantId = getTenantIdFromReq(req);
        const sock = getSockForTenant(tenantId);
        if (!sock) return res.status(422).json({ status: false, message: "Bot no está conectado" });

        if (!groupJid || !message) {
            return res.status(400).json({
                status: false,
                message: "Faltan parámetros: groupJid, message"
            });
        }

        // Agregar mensaje de grupo a la cola
        const promise = messageQueue.addToQueue({ type: 'group', sock: sock, tenantId, groupJid: groupJid, message: message });

    console.log(`✅ Mensaje agregado a la cola para grupo ${groupJid} (tenant: ${tenantId})`);

        promise.then(result => {
            console.log(`🔔 Mensaje de grupo procesado (background):`, result?.data || result);
        }).catch(err => {
            console.error(`❌ Error procesando mensaje de grupo en la cola (background):`, err?.message || err);
        });

        return res.status(200).json({
            status: true,
            message: "Mensaje agregado a la cola de envío",
            queueInfo: messageQueue.getQueueInfo()
        });

    } catch (error) {
        console.error("Error en sendToGroup:", error);
        return res.status(500).json({
            status: false,
            message: error.message,
            response: error
        });
    }
};

// ============================================================
// GESTIÓN DE COLA - NUEVAS FUNCIONES
// ============================================================

/**
 * Obtener estadísticas y estado de la cola
 */
export const getQueueStats = async (req, res) => {
    try {
        const stats = messageQueue.getStats();
        const info = messageQueue.getQueueInfo();

        return res.status(200).json({
            status: true,
            stats: stats,
            queueInfo: info
        });

    } catch (error) {
        console.error("Error en getQueueStats:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

/**
 * Configurar el delay entre mensajes (LEGACY - mantener por compatibilidad)
 */
export const setQueueDelay = async (req, res) => {
    try {
        const { delay } = req.body;

        if (!delay || delay < 1000) {
            return res.status(400).json({
                status: false,
                message: "El delay debe ser al menos 1000ms (1 segundo)"
            });
        }

        messageQueue.setDelay(delay, delay * 2);

        return res.status(200).json({
            status: true,
            message: `Delay dinámico configurado: ${delay}ms - ${delay * 2}ms`,
            config: messageQueue.config
        });

    } catch (error) {
        console.error("Error en setQueueDelay:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

/**
 * Configurar preset de delay dinámico
 */
export const setQueuePreset = async (req, res) => {
    try {
        const { preset } = req.body;

        if (!preset) {
            return res.status(400).json({
                status: false,
                message: "Debe proporcionar un preset: rapido, moderado, seguro, ultra-seguro"
            });
        }

        messageQueue.setDelayPreset(preset);

        return res.status(200).json({
            status: true,
            message: `Preset "${preset}" aplicado exitosamente`,
            config: messageQueue.config
        });

    } catch (error) {
        console.error("Error en setQueuePreset:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

/**
 * Activar/desactivar patrón humano
 */
export const setHumanPattern = async (req, res) => {
    try {
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                status: false,
                message: "Debe proporcionar enabled: true o false"
            });
        }

        messageQueue.setHumanPattern(enabled);

        return res.status(200).json({
            status: true,
            message: `Patrón humano ${enabled ? 'activado' : 'desactivado'}`,
            config: messageQueue.config
        });

    } catch (error) {
        console.error("Error en setHumanPattern:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};

/**
 * Limpiar la cola de mensajes pendientes
 */
export const clearQueue = async (req, res) => {
    try {
        const result = messageQueue.clearQueue();

        return res.status(200).json({
            status: true,
            message: "Cola limpiada exitosamente",
            canceled: result.canceled
        });

    } catch (error) {
        console.error("Error en clearQueue:", error);
        return res.status(500).json({
            status: false,
            message: error.message
        });
    }
};
