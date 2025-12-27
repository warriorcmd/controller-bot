/**
 * Sistema de Cola de Mensajes para evitar límites de WhatsApp
 * Implementa un queue que envía mensajes de forma secuencial con delay
 */

import { getTenantState } from "./botState.js";

class MessageQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.config = {
            minDelay: 8000, // Mínimo 8 segundos entre mensajes
            maxDelay: 20000, // Máximo 20 segundos entre mensajes
            randomVariation: true, // Activar variación aleatoria
            humanPattern: true, // Simular pausas humanas
            maxRetries: 3,
            retryDelay: 3000 // 3 segundos antes de reintentar
        };
        this.stats = {
            totalQueued: 0,
            totalSent: 0,
            totalFailed: 0,
            currentQueueSize: 0,
            averageDelay: 0
        };
        this.lastSendTime = null;
        this.consecutiveMessages = 0;
    }

    /**
     * Configurar delays personalizados
     */
    setDelay(minMs, maxMs) {
        this.config.minDelay = minMs;
        this.config.maxDelay = maxMs || minMs * 2;
        console.log(`⚙️ Delay dinámico configurado: ${minMs}ms - ${this.config.maxDelay}ms`);
    }

    /**
     * Calcular delay dinámico con patrón humano
     */
    calculateDynamicDelay() {
        const { minDelay, maxDelay, humanPattern } = this.config;
        
        // Delay base aleatorio entre min y max
        let delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        
        // Si está activado el patrón humano, añadir variaciones adicionales
        if (humanPattern) {
            // Cada 5-7 mensajes, hacer una pausa más larga (simular distracción humana)
            this.consecutiveMessages++;
            
            if (this.consecutiveMessages >= Math.floor(Math.random() * 3) + 5) {
                const longPause = Math.floor(Math.random() * 15000) + 25000; // 25-40 segundos
                console.log(`🧑 Pausa humana extendida: ${longPause}ms`);
                this.consecutiveMessages = 0;
                return longPause;
            }
            
            // Añadir micro-variaciones (±2 segundos aleatorios)
            const microVariation = Math.floor(Math.random() * 4000) - 2000;
            delay += microVariation;
        }
        
        // Asegurar que no sea menor al mínimo
        delay = Math.max(delay, minDelay);
        
        // Actualizar estadística
        this.updateAverageDelay(delay);
        
        return delay;
    }

    /**
     * Actualizar promedio de delay para estadísticas
     */
    updateAverageDelay(currentDelay) {
        if (this.stats.totalSent === 0) {
            this.stats.averageDelay = currentDelay;
        } else {
            this.stats.averageDelay = Math.floor(
                (this.stats.averageDelay * this.stats.totalSent + currentDelay) / 
                (this.stats.totalSent + 1)
            );
        }
    }

    /**
     * Agregar mensaje a la cola
     */
    async addToQueue(messageData) {
        return new Promise((resolve, reject) => {
            // Asegurar que siempre haya tenantId en el data del item
            if (!messageData.tenantId) messageData.tenantId = messageData?.tenantId || 'default';

            const queueItem = {
                id: Date.now() + Math.random(),
                data: messageData,
                retries: 0,
                addedAt: new Date(),
                resolve,
                reject
            };

            this.queue.push(queueItem);
            this.stats.totalQueued++;
            this.stats.currentQueueSize = this.queue.length;

            console.log(`📥 Mensaje agregado a la cola (tenant: ${messageData.tenantId}, posición: ${this.queue.length})`);

            // Si no se está procesando, iniciar procesamiento
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    /**
     * Procesar la cola de mensajes de forma secuencial
     */
    async processQueue() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        console.log(`🚀 Iniciando procesamiento de cola (${this.queue.length} mensajes pendientes)`);

        while (this.queue.length > 0) {
            const item = this.queue[0]; // Obtener el primero sin quitarlo aún
            // Si el item está marcado como en espera (waiting) lo saltamos en esta pasada
            // (se utiliza cuando el tenant está desconectado para no consumir retries)
            if (item.waiting) {
                // Si todos los items están en espera, esperamos un poco antes de reintentar
                const allWaiting = this.queue.every(q => q.waiting);
                if (allWaiting) {
                    console.log('⏳ Todos los mensajes están esperando reconexión. Esperando 5s antes de reintentar...');
                    await this.sleep(5000);

                    // Después de esperar, re-evaluar los items en espera: si el tenant se reconectó,
                    // actualizar la referencia del socket y limpiar la marca 'waiting' para que
                    // sean procesados en la siguiente iteración.
                    for (const qItem of this.queue) {
                        if (!qItem.waiting) continue;
                        try {
                            const tId = qItem.data?.tenantId || 'default';
                            const tstate = getTenantState(tId);
                            if (tstate && tstate.connectionStatus === 'connected') {
                                if (tstate.sock && tstate.sock !== qItem.data.sock) {
                                    console.log(`ℹ️ Socket para ${tId} cambió — actualizando referencia para mensaje ${qItem.id} y limpiando espera`);
                                    qItem.data.sock = tstate.sock;
                                }
                                qItem.waiting = false;
                            }
                        } catch (err) {
                            // No bloquear el loop por errores al re-evaluar
                            console.error('Error re-evaluando item en espera:', err?.message || err);
                        }
                    }
                } else {
                    // Mover este item al final para procesar otros
                    this.queue.shift();
                    this.queue.push(item);
                }
                continue;
            }

            try {
                console.log(`⏳ Procesando mensaje ${item.id} (${item.data.type}) a ${item.data.number || item.data.groupJid}`);
                
                // Antes de enviar, comprobar si el tenant/socket está conectado. Si no, marcar en espera
                const tenantIdFromData = item.data?.tenantId || 'default';
                const tenantState = getTenantState(tenantIdFromData);
                // Si no hay estado o no está conectado, marcar en espera
                if (!tenantState || tenantState.connectionStatus !== 'connected') {
                    console.log(`⚠️ Tenant ${tenantIdFromData} desconectado — marcando mensaje ${item.id} en espera`);
                    item.waiting = true;
                    // Mover al final de la cola para intentar otros mensajes
                    this.queue.shift();
                    this.queue.push(item);
                    // No consumir retry en este caso. Continuar con siguiente mensaje.
                    continue;
                }

                // Si el tenant está conectado pero la referencia del socket cambió,
                // actualizar la referencia del socket en el item para poder enviar.
                if (tenantState.sock && tenantState.sock !== item.data.sock) {
                    console.log(`ℹ️ Socket para ${tenantIdFromData} cambió — actualizando referencia para mensaje ${item.id}`);
                    item.data.sock = tenantState.sock;
                }

                // Ejecutar el envío del mensaje
                const result = await this.sendMessage(item);
                
                // Si fue exitoso, resolver la promesa y quitar de la cola
                item.resolve(result);
                // Si estaba en espera, limpiar la marca
                if (item.waiting) item.waiting = false;
                this.queue.shift();
                this.stats.totalSent++;
                this.stats.currentQueueSize = this.queue.length;
                
                console.log(`✅ Mensaje enviado exitosamente (${this.queue.length} restantes en cola)`);
                
                // Calcular delay dinámico antes del siguiente mensaje
                if (this.queue.length > 0) {
                    const dynamicDelay = this.calculateDynamicDelay();
                    console.log(`⏱️ Esperando ${dynamicDelay}ms (${(dynamicDelay/1000).toFixed(1)}s) antes del siguiente mensaje...`);
                    this.lastSendTime = Date.now();
                    await this.sleep(dynamicDelay);
                }
                
            } catch (error) {
                console.error(`❌ Error al enviar mensaje ${item.id}:`, error.message);
                
                // Intentar reintentar si no se alcanzó el máximo
                if (item.retries < this.config.maxRetries) {
                    item.retries++;
                    console.log(`🔄 Reintentando mensaje ${item.id} (intento ${item.retries}/${this.config.maxRetries})`);
                    
                    // Mover al final de la cola y esperar antes de reintentar
                    this.queue.shift();
                    this.queue.push(item);
                    await this.sleep(this.config.retryDelay);
                    
                } else {
                    // Si falló definitivamente, rechazar y quitar de la cola
                    console.log(`💀 Mensaje ${item.id} falló después de ${this.config.maxRetries} intentos`);
                    item.reject(error);
                    this.queue.shift();
                    this.stats.totalFailed++;
                    this.stats.currentQueueSize = this.queue.length;
                }
            }
        }

        console.log(`✨ Cola procesada completamente`);
        this.isProcessing = false;
    }

    /**
     * Enviar mensaje según el tipo
     */
    async sendMessage(item) {
        const { sock, data } = item;
        
        switch (data.type) {
            case 'text':
                return await this.sendTextMessage(item);
            
            case 'media':
                return await this.sendMediaMessage(item);
            
            case 'group':
                return await this.sendGroupMessage(item);
            
            default:
                throw new Error(`Tipo de mensaje desconocido: ${data.type}`);
        }
    }

    /**
     * Enviar mensaje de texto
     */
    async sendTextMessage(item) {
        const { data } = item;
        const jid = data.number.includes("@") ? data.number : `${data.number}@c.us`;

        // Verificar que el socket del tenant siga siendo el mismo y esté conectado
        const tId = data?.tenantId || 'default';
        const tstate = getTenantState(tId);
        if (!tstate || tstate.connectionStatus !== 'connected' || tstate.sock !== data.sock) {
            console.log(`⚠️ Socket no conectado o cambiado para tenant ${tId}, abortando envío temporalmente`);
            throw new Error('Connection Closed');
        }

        const response = await data.sock.sendMessage(jid, { text: data.message });

        return {
            status: true,
            response: response,
            data: {
                number: data.number,
                messageLength: data.message.length,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Enviar mensaje con archivo/media
     */
    async sendMediaMessage(item) {
        const { data } = item;
        const jid = data.number.includes("@") ? data.number : `${data.number}@c.us`;
        
        let messageContent = {};
        const file = data.file;
        const mimeType = file.mimetype;
        
        if (mimeType.startsWith("image/")) {
            messageContent = {
                image: file.data,
                caption: data.caption || "",
                mimetype: mimeType
            };
        } else if (mimeType.startsWith("video/")) {
            messageContent = {
                video: file.data,
                caption: data.caption || "",
                mimetype: mimeType
            };
        } else if (mimeType.startsWith("audio/")) {
            messageContent = {
                audio: file.data,
                mimetype: mimeType
            };
        } else {
            messageContent = {
                document: file.data,
                mimetype: mimeType,
                fileName: file.name,
                caption: data.caption || ""
            };
        }
        
        // Verificar socket activo antes de enviar
        const tId = data?.tenantId || 'default';
        const tstate = getTenantState(tId);
        if (!tstate || tstate.connectionStatus !== 'connected' || tstate.sock !== data.sock) {
            console.log(`⚠️ Socket no conectado o cambiado para tenant ${tId}, abortando envío de media temporalmente`);
            throw new Error('Connection Closed');
        }

        const response = await data.sock.sendMessage(jid, messageContent);
        
        return {
            status: true,
            response: response,
            data: {
                number: data.number,
                fileName: file.name,
                fileSize: file.size,
                fileType: mimeType,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Enviar mensaje a grupo
     */
    async sendGroupMessage(item) {
        const { data } = item;
        const jid = data.groupJid.includes("@") ? data.groupJid : `${data.groupJid}@g.us`;

        // Verificar socket activo antes de enviar a grupo
        const tId = data?.tenantId || 'default';
        const tstate = getTenantState(tId);
        if (!tstate || tstate.connectionStatus !== 'connected' || tstate.sock !== data.sock) {
            console.log(`⚠️ Socket no conectado o cambiado para tenant ${tId}, abortando envío a grupo temporalmente`);
            throw new Error('Connection Closed');
        }

        const response = await data.sock.sendMessage(jid, { text: data.message });

        return {
            status: true,
            response: response,
            data: {
                groupJid: jid,
                messageLength: data.message.length,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Función auxiliar para hacer delay
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtener estadísticas de la cola
     */
    getStats() {
        return {
            ...this.stats,
            isProcessing: this.isProcessing,
            config: this.config
        };
    }

    /**
     * Limpiar cola (cancelar todos los mensajes pendientes)
     */
    clearQueue() {
        const canceledCount = this.queue.length;
        
        // Rechazar todos los mensajes pendientes
        this.queue.forEach(item => {
            item.reject(new Error('Cola cancelada manualmente'));
        });
        
        this.queue = [];
        this.stats.currentQueueSize = 0;
        
        console.log(`🗑️ Cola limpiada (${canceledCount} mensajes cancelados)`);
        
        return { canceled: canceledCount };
    }

    /**
     * Obtener información de la cola actual
     */
    getQueueInfo() {
        const avgDelaySeconds = (this.stats.averageDelay / 1000).toFixed(1);
        const estimatedMinTime = this.queue.length * this.config.minDelay;
        const estimatedMaxTime = this.queue.length * this.config.maxDelay;
        
        return {
            queueSize: this.queue.length,
            isProcessing: this.isProcessing,
            nextMessage: this.queue.length > 0 ? {
                position: 1,
                type: this.queue[0].data.type,
                addedAt: this.queue[0].addedAt,
                retries: this.queue[0].retries
            } : null,
            estimatedWaitTime: {
                min: estimatedMinTime,
                max: estimatedMaxTime,
                minFormatted: `${(estimatedMinTime / 1000 / 60).toFixed(1)} minutos`,
                maxFormatted: `${(estimatedMaxTime / 1000 / 60).toFixed(1)} minutos`
            },
            averageDelay: `${avgDelaySeconds}s`,
            consecutiveMessages: this.consecutiveMessages
        };
    }

    /**
     * Configurar patrón humano (activar/desactivar)
     */
    setHumanPattern(enabled) {
        this.config.humanPattern = enabled;
        console.log(`${enabled ? '✅' : '❌'} Patrón humano ${enabled ? 'activado' : 'desactivado'}`);
    }

    /**
     * Configurar rango de delays con presets
     */
    setDelayPreset(preset) {
        const presets = {
            'rapido': { min: 5000, max: 12000 },      // 5-12s (riesgoso)
            'moderado': { min: 8000, max: 20000 },    // 8-20s (recomendado)
            'seguro': { min: 15000, max: 35000 },     // 15-35s (muy seguro)
            'ultra-seguro': { min: 20000, max: 45000 } // 20-45s (máxima precaución)
        };
        
        if (presets[preset]) {
            this.config.minDelay = presets[preset].min;
            this.config.maxDelay = presets[preset].max;
            console.log(`⚙️ Preset "${preset}" aplicado: ${presets[preset].min}ms - ${presets[preset].max}ms`);
        } else {
            console.log(`❌ Preset desconocido. Opciones: ${Object.keys(presets).join(', ')}`);
        }
    }

    // Importar getTenantState de botState para verificar estado del tenant antes de enviar
}

// Exportar una única instancia (Singleton)
const messageQueue = new MessageQueue();

export default messageQueue;
