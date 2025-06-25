const { Client, Location, Poll, List, Buttons, LocalAuth } = require('./index');
const fetch = require('node-fetch');
const apiConfig = require('./api-config');
const http = require('http');
const url = require('url');

// HTTP Server Configuration
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTP_AUTH_TOKEN = process.env.WHATSAPP_SEND_AUTH_TOKEN || 'your-secret-token-here';

const client = new Client({
    authStrategy: new LocalAuth(),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: { 
        // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
        headless: true, // Changed to true for server deployment
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Function to check if message should be forwarded based on filters
function shouldForwardMessage(sender, message, additionalData) {
    const { filters } = apiConfig;
    
    // Skip if API forwarding is disabled
    if (!apiConfig.enabled) {
        return false;
    }
    
    // Skip own messages if configured
    if (filters.skipOwnMessages && additionalData.isFromMe) {
        return false;
    }
    
    // Skip group messages if configured
    if (filters.skipGroupMessages && additionalData.chatType === 'group') {
        return false;
    }
    
    // Check allowed senders
    if (filters.allowedSenders.length > 0 && !filters.allowedSenders.includes(sender)) {
        return false;
    }
    
    // Check required keywords
    if (filters.requiredKeywords.length > 0) {
        const hasKeyword = filters.requiredKeywords.some(keyword => 
            message.toLowerCase().includes(keyword.toLowerCase())
        );
        if (!hasKeyword) {
            return false;
        }
    }
    
    return true;
}

// Function to send message to your API with retry logic
async function forwardMessageToAPI(sender, message, additionalData = {}) {
    const { retryAttempts, retryDelay } = apiConfig;
    
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
            const payload = {
                sender: sender,
                message: message,
                timestamp: new Date().toISOString(),
                ...additionalData
            };

            // Debug: Show detailed payload information
            if (apiConfig.debug) {
                console.log('🔍 DEBUG: Forwarding message to API');
                console.log('📤 Payload:', JSON.stringify(payload, null, 2));
                console.log('🌐 Endpoint:', apiConfig.endpoint);
                console.log('🔑 API Key:', apiConfig.apiKey ? '***' + apiConfig.apiKey.slice(-4) : 'None');
                console.log('⏱️  Timeout:', apiConfig.timeout + 'ms');
                console.log('🔄 Attempt:', `${attempt}/${retryAttempts}`);
            }

            const response = await fetch(apiConfig.endpoint, {
                method: 'POST',
                headers: {
                    ...apiConfig.headers,
                    'Authorization': `Bearer ${apiConfig.apiKey}`
                },
                body: JSON.stringify(payload),
                timeout: apiConfig.timeout
            });

            if (response.ok) {
                if (apiConfig.debug) {
                    console.log(`✅ DEBUG: API request successful`);
                    console.log(`📊 Status: ${response.status} ${response.statusText}`);
                    console.log(`📋 Headers:`, Object.fromEntries(response.headers.entries()));
                } else if (apiConfig.logSuccess) {
                    console.log(`✅ Message forwarded to API successfully. Status: ${response.status}`);
                }
                return true;
            } else {
                const responseText = await response.text();
                if (apiConfig.debug) {
                    console.log(`❌ DEBUG: API request failed`);
                    console.log(`📊 Status: ${response.status} ${response.statusText}`);
                    console.log(`📋 Response Headers:`, Object.fromEntries(response.headers.entries()));
                    console.log(`📄 Response Body: ${responseText}`);
                } else if (apiConfig.logErrors) {
                    console.error(`❌ API request failed. Status: ${response.status}, Response: ${responseText}`);
                }
                
                // If it's the last attempt, return false
                if (attempt === retryAttempts) {
                    return false;
                }
                
                // Wait before retrying
                if (apiConfig.debug) {
                    console.log(`⏳ DEBUG: Waiting ${retryDelay}ms before retry...`);
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        } catch (error) {
            if (apiConfig.debug) {
                console.log(`❌ DEBUG: Network/connection error`);
                console.log(`🔍 Error Type: ${error.name}`);
                console.log(`📝 Error Message: ${error.message}`);
                console.log(`📚 Error Stack: ${error.stack}`);
            } else if (apiConfig.logErrors) {
                console.error(`❌ Error forwarding message to API (attempt ${attempt}/${retryAttempts}): ${error.message}`);
            }
            
            // If it's the last attempt, return false
            if (attempt === retryAttempts) {
                return false;
            }
            
            // Wait before retrying
            if (apiConfig.debug) {
                console.log(`⏳ DEBUG: Waiting ${retryDelay}ms before retry...`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
    
    return false;
}

// Function to test API connection
async function testAPIConnection() {
    console.log('🧪 Testing API connection...');
    
    const testPayload = {
        sender: 'test@c.us',
        message: 'This is a test message from WhatsApp bot',
        timestamp: new Date().toISOString(),
        test: true
    };

    try {
        const response = await fetch(apiConfig.endpoint, {
            method: 'POST',
            headers: {
                ...apiConfig.headers,
                'Authorization': `Bearer ${apiConfig.apiKey}`
            },
            body: JSON.stringify(testPayload),
            timeout: apiConfig.timeout
        });

        console.log(`🧪 Test API Response Status: ${response.status}`);
        const responseText = await response.text();
        console.log(`🧪 Test API Response Body: ${responseText}`);
        
        if (response.ok) {
            console.log('✅ API connection test successful!');
        } else {
            console.log('❌ API connection test failed!');
        }
    } catch (error) {
        console.error('❌ API connection test error:', error.message);
    }
}

// client initialize does not finish at ready now.
// client.initialize(); // REMOVED - now handled in initializeWhatsApp()

client.on('loading_screen', (percent, message) => {
    console.log(`📱 Loading: ${percent}% - ${message}`);
});

// Pairing code only needs to be requested once
let pairingCodeRequested = false;
let qrCodeShown = false;

client.on('qr', async (qr) => {
    console.log('🔐 QR Code received - waiting for scan...');
    // NOTE: This event will not be fired if a session is specified.
    if (!qrCodeShown) {
        console.log('==========================================');
        console.log('🔐 WHATSAPP QR CODE - SCAN WITH YOUR PHONE');
        console.log('==========================================');
        console.log('QR CODE DATA:');
        console.log(qr);
        console.log('==========================================');
        console.log('📱 Instructions:');
        console.log('Convert code to QR - https://www.qr-code-generator.com/');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Go to Settings > Linked Devices > Link a Device');
        console.log('3. Scan the QR code above');
        console.log('4. Wait for authentication...');
        console.log('==========================================');
        qrCodeShown = true;
    }

    // paiuting code example
    const pairingCodeEnabled = false;
    if (pairingCodeEnabled && !pairingCodeRequested) {
        const pairingCode = await client.requestPairingCode('96170100100'); // enter the target phone number
        console.log('Pairing code enabled, code: '+ pairingCode);
        pairingCodeRequested = true;
    }
});

client.on('authenticated', () => {
    console.log('✅ AUTHENTICATED - WhatsApp session restored or QR scanned');
});

client.on('auth_failure', msg => {
    console.error('❌ AUTHENTICATION FAILURE:', msg);
});

client.on('ready', async () => {
    console.log('✅ READY - WhatsApp client is fully connected');
    const debugWWebVersion = await client.getWWebVersion();
    console.log(`📱 WWebVersion = ${debugWWebVersion}`);
    
    // Log API configuration status
    if (apiConfig.enabled) {
        console.log(`📡 API forwarding enabled to: ${apiConfig.endpoint}`);
    } else {
        console.log('📡 API forwarding disabled');
    }
    
    // Log debug status
    console.log(`🔍 Debug mode: ${apiConfig.debug ? 'ENABLED' : 'DISABLED'}`);
    if (apiConfig.debug) {
        console.log('🔍 Debug features:');
        console.log('  - Detailed message logging');
        console.log('  - API request/response logging');
        console.log('  - Error details and stack traces');
        console.log('  - Debug mode can be controlled via api-config.js');
    }

    client.pupPage.on('pageerror', function(err) {
        console.log('❌ Page error: ' + err.toString());
    });
    client.pupPage.on('error', function(err) {
        console.log('❌ Page error: ' + err.toString());
    });
    
});

client.on('disconnected', (reason) => {
    console.log('❌ Client was logged out:', reason);
});

client.on('message', async msg => {
    // Debug mode: Show detailed message info
    if (apiConfig.debug) {
        console.log('📨 MESSAGE RECEIVED');
        console.log('📋 Basic Info:', {
            type: msg.type,
            from: msg.from,
            to: msg.to,
            body: msg.body,
            timestamp: new Date(msg.timestamp * 1000).toISOString(),
            messageId: msg.id._serialized
        });
        console.log('🔍 Full Message Details:', {
            hasMedia: msg.hasMedia,
            isFromMe: msg.fromMe,
            hasQuotedMsg: msg.hasQuotedMsg,
            hasReaction: msg.hasReaction,
            isForwarded: msg.isForwarded,
            isStatus: msg.isStatus,
            isStarred: msg.isStarred,
            deviceType: msg.deviceType,
            broadcast: msg.broadcast,
            duration: msg.duration,
            location: msg.location,
            vCards: msg.vCards,
            mentionedIds: msg.mentionedIds,
            groupMentions: msg.groupMentions,
            links: msg.links
        });
    }

    // Extract sender information
    const sender = msg.from;
    const message = msg.body;
    const chat = await msg.getChat();
    
    // Prepare additional data for API
    const additionalData = {
        messageId: msg.id._serialized,
        chatType: chat.isGroup ? 'group' : 'private',
        chatName: chat.name || 'Unknown',
        messageType: msg.type,
        hasMedia: msg.hasMedia,
        timestamp: msg.timestamp,
        isFromMe: msg.fromMe
    };

    // Check if message should be forwarded
    if (shouldForwardMessage(sender, message, additionalData)) {
        if (apiConfig.debug) {
            console.log(`📤 Forwarding message from ${sender}: "${message}"`);
            console.log(`📊 Additional Data:`, JSON.stringify(additionalData, null, 2));
        }
        await forwardMessageToAPI(sender, message, additionalData);
    } else if (apiConfig.debug) {
        console.log(`⏭️  Skipping message from ${sender} (filtered out)`);
    }

    // Original bot commands (optional - you can remove these if you only want forwarding)
    // COMMENTED OUT: Bot commands removed to prevent user interaction
    // 
    // Example 1: Simple ping command (commented for future reference)
    // if (msg.body === '!ping') {
    //     client.sendMessage(msg.from, 'pong');
    // }
    // 
    // Example 2: Info command (commented for future reference)
    // else if (msg.body === '!info') {
    //     let info = client.info;
    //     client.sendMessage(msg.from, `
    //         *Connection info*
    //         User name: ${info.pushname}
    //         My number: ${info.wid.user}
    //         Platform: ${info.platform}
    //     `);
    // }
});

client.on('message_create', async (msg) => {
    // Fired on all message creations, including your own
    if (msg.fromMe) {
        // do stuff here
    }

    // Bot commands removed - no user interaction allowed
});

client.on('message_ciphertext', (msg) => {
    // Receiving new incoming messages that have been encrypted
    // msg.type === 'ciphertext'
    msg.body = 'Waiting for this message. Check your phone.';
    
    // do stuff here
});

client.on('message_revoke_everyone', async (after, before) => {
    // Fired whenever a message is deleted by anyone (including you)
    console.log(after); // message after it was deleted.
    if (before) {
        console.log(before); // message before it was deleted.
    }
});

client.on('message_revoke_me', async (msg) => {
    // Fired whenever a message is only deleted in your own view.
    console.log(msg.body); // message before it was deleted.
});

client.on('message_ack', (msg, ack) => {
    /*
        == ACK VALUES ==
        ACK_ERROR: -1
        ACK_PENDING: 0
        ACK_SERVER: 1
        ACK_DEVICE: 2
        ACK_READ: 3
        ACK_PLAYED: 4
    */

    if (ack == 3) {
        // The message was read
    }
});

client.on('group_join', (notification) => {
    // User has joined or been added to the group.
    console.log('join', notification);
    notification.reply('User joined.');
});

client.on('group_leave', (notification) => {
    // User has left or been kicked from the group.
    console.log('leave', notification);
    notification.reply('User left.');
});

client.on('group_update', (notification) => {
    // Group picture, subject or description has been updated.
    console.log('update', notification);
});

client.on('change_state', state => {
    console.log('CHANGE STATE', state);
});

// Change to false if you don't want to reject incoming calls
let rejectCalls = true;

client.on('call', async (call) => {
    console.log('Call received, rejecting. GOTO Line 261 to disable', call);
    if (rejectCalls) await call.reject();
    await client.sendMessage(call.from, `[${call.fromMe ? 'Outgoing' : 'Incoming'}] Phone call from ${call.from}, type ${call.isGroup ? 'group' : ''} ${call.isVideo ? 'video' : 'audio'} call. ${rejectCalls ? 'This call was automatically rejected by the script.' : ''}`);
});

client.on('contact_changed', async (message, oldId, newId, isContact) => {
    /** The time the event occurred. */
    const eventTime = (new Date(message.timestamp * 1000)).toLocaleString();

    console.log(
        `The contact ${oldId.slice(0, -5)}` +
        `${!isContact ? ' that participates in group ' +
            `${(await client.getChatById(message.to ?? message.from)).name} ` : ' '}` +
        `changed their phone number\nat ${eventTime}.\n` +
        `Their new phone number is ${newId.slice(0, -5)}.\n`);

    /**
     * Information about the @param {message}:
     * 
     * 1. If a notification was emitted due to a group participant changing their phone number:
     * @param {message.author} is a participant's id before the change.
     * @param {message.recipients[0]} is a participant's id after the change (a new one).
     * 
     * 1.1 If the contact who changed their number WAS in the current user's contact list at the time of the change:
     * @param {message.to} is a group chat id the event was emitted in.
     * @param {message.from} is a current user's id that got an notification message in the group.
     * Also the @param {message.fromMe} is TRUE.
     * 
     * 1.2 Otherwise:
     * @param {message.from} is a group chat id the event was emitted in.
     * @param {message.to} is @type {undefined}.
     * Also @param {message.fromMe} is FALSE.
     * 
     * 2. If a notification was emitted due to a contact changing their phone number:
     * @param {message.templateParams} is an array of two user's ids:
     * the old (before the change) and a new one, stored in alphabetical order.
     * @param {message.from} is a current user's id that has a chat with a user,
     * whos phone number was changed.
     * @param {message.to} is a user's id (after the change), the current user has a chat with.
     */
});

client.on('group_admin_changed', (notification) => {
    if (notification.type === 'promote') {
        /** 
          * Emitted when a current user is promoted to an admin.
          * {@link notification.author} is a user who performs the action of promoting/demoting the current user.
          */
        console.log(`You were promoted by ${notification.author}`);
    } else if (notification.type === 'demote')
        /** Emitted when a current user is demoted to a regular user. */
        console.log(`You were demoted by ${notification.author}`);
});

client.on('group_membership_request', async (notification) => {
    /**
     * The example of the {@link notification} output:
     * {
     *     id: {
     *         fromMe: false,
     *         remote: 'groupId@g.us',
     *         id: '123123123132132132',
     *         participant: 'number@c.us',
     *         _serialized: 'false_groupId@g.us_123123123132132132_number@c.us'
     *     },
     *     body: '',
     *     type: 'created_membership_requests',
     *     timestamp: 1694456538,
     *     chatId: 'groupId@g.us',
     *     author: 'number@c.us',
     *     recipientIds: []
     * }
     *
     */
    console.log(notification);
    /** You can approve or reject the newly appeared membership request: */
    await client.approveGroupMembershipRequestss(notification.chatId, notification.author);
    await client.rejectGroupMembershipRequests(notification.chatId, notification.author);
});

client.on('message_reaction', async (reaction) => {
    console.log('REACTION RECEIVED', reaction);
});

client.on('vote_update', (vote) => {
    /** The vote that was affected: */
    console.log(vote);
});

// HTTP Server for sending messages via API
const server = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Check authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${HTTP_AUTH_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (req.method === 'POST' && path === '/send') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { to, message, type = 'text' } = data;

                if (!to || !message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: to, message' }));
                    return;
                }

                // Format phone number
                let phoneNumber = to;
                if (!phoneNumber.includes('@c.us') && !phoneNumber.includes('@g.us')) {
                    phoneNumber = `${phoneNumber}@c.us`;
                }

                let result;
                switch (type) {
                    case 'text':
                        result = await client.sendMessage(phoneNumber, message);
                        break;
                    case 'location':
                        const { latitude, longitude, name, address } = data;
                        if (!latitude || !longitude) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Location requires latitude and longitude' }));
                            return;
                        }
                        result = await client.sendMessage(phoneNumber, new Location(latitude, longitude, name, address));
                        break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Unsupported message type' }));
                        return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    messageId: result.id._serialized,
                    timestamp: result.timestamp 
                }));

            } catch (error) {
                console.error('Error sending message:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to send message', details: error.message }));
            }
        });
    } else if (req.method === 'GET' && path === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'running',
            whatsapp: client.info ? 'connected' : 'connecting',
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

// Start HTTP server
server.listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
    console.log(`📤 Send messages via POST http://localhost:${HTTP_PORT}/send`);
    console.log(`📊 Check status via GET http://localhost:${HTTP_PORT}/status`);
    
    // Log debug status on startup
    console.log(`🔍 Debug mode: ${apiConfig.debug ? 'ENABLED' : 'DISABLED'}`);
    if (apiConfig.debug) {
        console.log('🔍 Debug features active:');
        console.log('  - Detailed message logging');
        console.log('  - API request/response logging');
        console.log('  - Error details and stack traces');
        console.log('  - Debug mode can be controlled via api-config.js');
    }
});

// Initialize WhatsApp client with error handling
async function initializeWhatsApp() {
    try {
        console.log('🚀 Initializing WhatsApp client...');
        console.log('📱 Setting up Puppeteer with headless mode...');
        
        console.log('🔄 Starting client initialization...');
        await client.initialize();
        console.log('✅ Client initialization completed');
        
    } catch (error) {
        console.error('❌ Error initializing WhatsApp client:', error.message);
        console.error('📚 Full error:', error);
        
        // Handle specific Puppeteer binding error
        if (error.message.includes('already exists')) {
            console.log('🔄 Detected Puppeteer binding conflict. Attempting to restart...');
            
            // Wait a bit and try again
            setTimeout(async () => {
                try {
                    console.log('🔄 Retrying WhatsApp client initialization...');
                    await client.initialize();
                } catch (retryError) {
                    console.error('❌ Retry failed:', retryError.message);
                    console.log('💡 Try restarting the service or clearing the cache');
                    process.exit(1);
                }
            }, 5000);
        } else {
            console.error('❌ Fatal error during initialization');
            process.exit(1);
        }
    }
}

initializeWhatsApp();
