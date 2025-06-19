const { Client, Location, Poll, List, Buttons, LocalAuth } = require('./index');
const fetch = require('node-fetch');
const apiConfig = require('./api-config');

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

            // Debug: Log the request details
            console.log(`🔍 DEBUG: Attempting API call (${attempt}/${retryAttempts})`);
            console.log(`🔍 DEBUG: Endpoint: ${apiConfig.endpoint}`);
            console.log(`🔍 DEBUG: Payload:`, JSON.stringify(payload, null, 2));
            console.log(`🔍 DEBUG: Headers:`, JSON.stringify({
                ...apiConfig.headers,
                'Authorization': `Bearer ${apiConfig.apiKey}`
            }, null, 2));

            const response = await fetch(apiConfig.endpoint, {
                method: 'POST',
                headers: {
                    ...apiConfig.headers,
                    'Authorization': `Bearer ${apiConfig.apiKey}`
                },
                body: JSON.stringify(payload),
                timeout: apiConfig.timeout
            });

            // Debug: Log the response details
            console.log(`🔍 DEBUG: Response status: ${response.status}`);
            console.log(`🔍 DEBUG: Response headers:`, JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
            
            const responseText = await response.text();
            console.log(`🔍 DEBUG: Response body: ${responseText}`);

            if (response.ok) {
                if (apiConfig.logSuccess) {
                    console.log(`✅ Message forwarded to API successfully. Status: ${response.status}`);
                }
                return true;
            } else {
                if (apiConfig.logErrors) {
                    console.error(`❌ API request failed. Status: ${response.status}, Response: ${responseText}`);
                }
                
                // If it's the last attempt, return false
                if (attempt === retryAttempts) {
                    return false;
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        } catch (error) {
            if (apiConfig.logErrors) {
                console.error(`❌ Error forwarding message to API (attempt ${attempt}/${retryAttempts}): ${error.message}`);
                console.error(`🔍 DEBUG: Full error:`, error);
            }
            
            // If it's the last attempt, return false
            if (attempt === retryAttempts) {
                return false;
            }
            
            // Wait before retrying
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
client.initialize();

client.on('loading_screen', (percent, message) => {
    console.log('LOADING SCREEN', percent, message);
});

// Pairing code only needs to be requested once
let pairingCodeRequested = false;
let qrCodeShown = false;

client.on('qr', async (qr) => {
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
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    // Fired if session restore was unsuccessful
    console.error('AUTHENTICATION FAILURE', msg);
});

client.on('ready', async () => {
    console.log('READY');
    const debugWWebVersion = await client.getWWebVersion();
    console.log(`WWebVersion = ${debugWWebVersion}`);
    
    // Log API configuration status
    if (apiConfig.enabled) {
        console.log(`📡 API forwarding enabled to: ${apiConfig.endpoint}`);
    } else {
        console.log('📡 API forwarding disabled');
    }

    client.pupPage.on('pageerror', function(err) {
        console.log('Page error: ' + err.toString());
    });
    client.pupPage.on('error', function(err) {
        console.log('Page error: ' + err.toString());
    });
    
});

client.on('message', async msg => {
    console.log('MESSAGE RECEIVED', msg);

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
        console.log(`📤 Forwarding message from ${sender}: "${message}"`);
        await forwardMessageToAPI(sender, message, additionalData);
    } else {
        console.log(`⏭️ Skipping message from ${sender} (filtered out)`);
    }

    // Original bot commands (optional - you can remove these if you only want forwarding)
    if (msg.body === '!ping reply') {
        // Send a new message as a reply to the current one
        msg.reply('pong');

    } else if (msg.body === '!ping') {
        // Send a new message to the same chat
        client.sendMessage(msg.from, 'pong');

    } else if (msg.body.startsWith('!sendto ')) {
        // Direct send a new message to specific id
        let number = msg.body.split(' ')[1];
        let messageIndex = msg.body.indexOf(number) + number.length;
        let message = msg.body.slice(messageIndex, msg.body.length);
        number = number.includes('@c.us') ? number : `${number}@c.us`;
        let chat = await msg.getChat();
        chat.sendSeen();
        client.sendMessage(number, message);

    } else if (msg.body.startsWith('!subject ')) {
        // Change the group subject
        let chat = await msg.getChat();
        if (chat.isGroup) {
            let newSubject = msg.body.slice(9);
            chat.setSubject(newSubject);
        } else {
            msg.reply('This command can only be used in a group!');
        }
    } else if (msg.body.startsWith('!echo ')) {
        // Replies with the same message
        msg.reply(msg.body.slice(6));
    } else if (msg.body.startsWith('!preview ')) {
        const text = msg.body.slice(9);
        msg.reply(text, null, { linkPreview: true });
    } else if (msg.body.startsWith('!desc ')) {
        // Change the group description
        let chat = await msg.getChat();
        if (chat.isGroup) {
            let newDescription = msg.body.slice(6);
            chat.setDescription(newDescription);
        } else {
            msg.reply('This command can only be used in a group!');
        }
    } else if (msg.body === '!leave') {
        // Leave the group
        let chat = await msg.getChat();
        if (chat.isGroup) {
            chat.leave();
        } else {
            msg.reply('This command can only be used in a group!');
        }
    } else if (msg.body.startsWith('!join ')) {
        const inviteCode = msg.body.split(' ')[1];
        try {
            await client.acceptInvite(inviteCode);
            msg.reply('Joined the group!');
        } catch (e) {
            msg.reply('That invite code seems to be invalid.');
        }
    } else if (msg.body.startsWith('!addmembers')) {
        const group = await msg.getChat();
        const result = await group.addParticipants(['number1@c.us', 'number2@c.us', 'number3@c.us']);
        /**
         * The example of the {@link result} output:
         *
         * {
         *   'number1@c.us': {
         *     code: 200,
         *     message: 'The participant was added successfully',
         *     isInviteV4Sent: false
         *   },
         *   'number2@c.us': {
         *     code: 403,
         *     message: 'The participant can be added by sending private invitation only',
         *     isInviteV4Sent: true
         *   },
         *   'number3@c.us': {
         *     code: 404,
         *     message: 'The phone number is not registered on WhatsApp',
         *     isInviteV4Sent: false
         *   }
         * }
         *
         * For more usage examples:
         * @see https://github.com/pedroslopez/whatsapp-web.js/pull/2344#usage-example1
         */
        console.log(result);
    } else if (msg.body === '!creategroup') {
        const partitipantsToAdd = ['number1@c.us', 'number2@c.us', 'number3@c.us'];
        const result = await client.createGroup('Group Title', partitipantsToAdd);
        /**
         * The example of the {@link result} output:
         * {
         *   title: 'Group Title',
         *   gid: {
         *     server: 'g.us',
         *     user: '1111111111',
         *     _serialized: '1111111111@g.us'
         *   },
         *   participants: {
         *     'botNumber@c.us': {
         *       statusCode: 200,
         *         message: 'The participant was added successfully',
         *         isGroupCreator: true,
         *         isInviteV4Sent: false
         *       },
         *       'number1@c.us': {
         *         statusCode: 200,
         *         message: 'The participant was added successfully',
         *         isGroupCreator: false,
         *         isInviteV4Sent: false
         *       },
         *       'number2@c.us': {
         *         statusCode: 403,
         *         message: 'The participant can be added by sending private invitation only',
         *         isGroupCreator: false,
         *         isInviteV4Sent: true
         *       },
         *       'number3@c.us': {
         *         statusCode: 404,
         *         message: 'The phone number is not registered on WhatsApp',
         *         isGroupCreator: false,
         *         isInviteV4Sent: false
         *       }
         *     }
         *   }
         * }
         *
         * For more usage examples:
         * @see https://github.com/pedroslopez/whatsapp-web.js/pull/2344#usage-example2
         */
        console.log(result);
    } else if (msg.body === '!groupinfo') {
        let chat = await msg.getChat();
        if (chat.isGroup) {
            msg.reply(`
                *Group Details*
                Name: ${chat.name}
                Description: ${chat.description}
                Created At: ${chat.createdAt.toString()}
                Created By: ${chat.owner.user}
                Participant count: ${chat.participants.length}
            `);
        } else {
            msg.reply('This command can only be used in a group!');
        }
    } else if (msg.body === '!chats') {
        const chats = await client.getChats();
        client.sendMessage(msg.from, `The bot has ${chats.length} chats open.`);
    } else if (msg.body === '!info') {
        let info = client.info;
        client.sendMessage(msg.from, `
            *Connection info*
            User name: ${info.pushname}
            My number: ${info.wid.user}
            Platform: ${info.platform}
        `);
    } else if (msg.body === '!testapi') {
        // Test API connection
        msg.reply('Testing API connection... Check the console for results.');
        await testAPIConnection();
    } else if (msg.body === '!mediainfo' && msg.hasMedia) {
        const attachmentData = await msg.downloadMedia();
        msg.reply(`
            *Media info*
            MimeType: ${attachmentData.mimetype}
            Filename: ${attachmentData.filename}
            Data (length): ${attachmentData.data.length}
        `);
    } else if (msg.body === '!quoteinfo' && msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();

        quotedMsg.reply(`
            ID: ${quotedMsg.id._serialized}
            Type: ${quotedMsg.type}
            Author: ${quotedMsg.author || quotedMsg.from}
            Timestamp: ${quotedMsg.timestamp}
            Has Media? ${quotedMsg.hasMedia}
        `);
    } else if (msg.body === '!resendmedia' && msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            const attachmentData = await quotedMsg.downloadMedia();
            client.sendMessage(msg.from, attachmentData, { caption: 'Here\'s your requested media.' });
        }
        if (quotedMsg.hasMedia && quotedMsg.type === 'audio') {
            const audio = await quotedMsg.downloadMedia();
            await client.sendMessage(msg.from, audio, { sendAudioAsVoice: true });
        }
    } else if (msg.body === '!isviewonce' && msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            const media = await quotedMsg.downloadMedia();
            await client.sendMessage(msg.from, media, { isViewOnce: true });
        }
    } else if (msg.body === '!location') {
        // only latitude and longitude
        await msg.reply(new Location(37.422, -122.084));
        // location with name only
        await msg.reply(new Location(37.422, -122.084, { name: 'Googleplex' }));
        // location with address only
        await msg.reply(new Location(37.422, -122.084, { address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA' }));
        // location with name, address and url
        await msg.reply(new Location(37.422, -122.084, { name: 'Googleplex', address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA', url: 'https://google.com' }));
    } else if (msg.location) {
        msg.reply(msg.location);
    } else if (msg.body.startsWith('!status ')) {
        const newStatus = msg.body.split(' ')[1];
        await client.setStatus(newStatus);
        msg.reply(`Status was updated to *${newStatus}*`);
    } else if (msg.body === '!mentionUsers') {
        const chat = await msg.getChat();
        const userNumber = 'XXXXXXXXXX';
        /**
         * To mention one user you can pass user's ID to 'mentions' property as is,
         * without wrapping it in Array, and a user's phone number to the message body:
         */
        await chat.sendMessage(`Hi @${userNumber}`, {
            mentions: userNumber + '@c.us'
        });
        // To mention a list of users:
        await chat.sendMessage(`Hi @${userNumber}, @${userNumber}`, {
            mentions: [userNumber + '@c.us', userNumber + '@c.us']
        });
    } else if (msg.body === '!mentionGroups') {
        const chat = await msg.getChat();
        const groupId = 'YYYYYYYYYY@g.us';
        /**
         * Sends clickable group mentions, the same as user mentions.
         * When the mentions are clicked, it opens a chat with the mentioned group.
         * The 'groupMentions.subject' can be custom
         * 
         * @note The user that does not participate in the mentioned group,
         * will not be able to click on that mentioned group, the same if the group does not exist
         *
         * To mention one group:
         */
        await chat.sendMessage(`Check the last message here: @${groupId}`, {
            groupMentions: { subject: 'GroupSubject', id: groupId }
        });
        // To mention a list of groups:
        await chat.sendMessage(`Check the last message in these groups: @${groupId}, @${groupId}`, {
            groupMentions: [
                { subject: 'FirstGroup', id: groupId },
                { subject: 'SecondGroup', id: groupId }
            ]
        });
    } else if (msg.body === '!getGroupMentions') {
        // To get group mentions from a message:
        const groupId = 'ZZZZZZZZZZ@g.us';
        const msg = await client.sendMessage('chatId', `Check the last message here: @${groupId}`, {
            groupMentions: { subject: 'GroupSubject', id: groupId }
        });
        /** {@link groupMentions} is an array of `GroupChat` */
        const groupMentions = await msg.getGroupMentions();
        console.log(groupMentions);
    } else if (msg.body === '!delete') {
        if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg.fromMe) {
                quotedMsg.delete(true);
            } else {
                msg.reply('I can only delete my own messages');
            }
        }
    } else if (msg.body === '!pin') {
        const chat = await msg.getChat();
        await chat.pin();
    } else if (msg.body === '!archive') {
        const chat = await msg.getChat();
        await chat.archive();
    } else if (msg.body === '!mute') {
        const chat = await msg.getChat();
        // mute the chat for 20 seconds
        const unmuteDate = new Date();
        unmuteDate.setSeconds(unmuteDate.getSeconds() + 20);
        await chat.mute(unmuteDate);
    } else if (msg.body === '!typing') {
        const chat = await msg.getChat();
        // simulates typing in the chat
        chat.sendStateTyping();
    } else if (msg.body === '!recording') {
        const chat = await msg.getChat();
        // simulates recording audio in the chat
        chat.sendStateRecording();
    } else if (msg.body === '!clearstate') {
        const chat = await msg.getChat();
        // stops typing or recording in the chat
        chat.clearState();
    } else if (msg.body === '!jumpto') {
        if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            client.interface.openChatWindowAt(quotedMsg.id._serialized);
        }
    } else if (msg.body === '!buttons') {
        let button = new Buttons('Button body', [{ body: 'bt1' }, { body: 'bt2' }, { body: 'bt3' }], 'title', 'footer');
        client.sendMessage(msg.from, button);
    } else if (msg.body === '!list') {
        let sections = [
            { title: 'sectionTitle', rows: [{ title: 'ListItem1', description: 'desc' }, { title: 'ListItem2' }] }
        ];
        let list = new List('List body', 'btnText', sections, 'Title', 'footer');
        client.sendMessage(msg.from, list);
    } else if (msg.body === '!reaction') {
        msg.react('👍');
    } else if (msg.body === '!sendpoll') {
        /** By default the poll is created as a single choice poll: */
        await msg.reply(new Poll('Winter or Summer?', ['Winter', 'Summer']));
        /** If you want to provide a multiple choice poll, add allowMultipleAnswers as true: */
        await msg.reply(new Poll('Cats or Dogs?', ['Cats', 'Dogs'], { allowMultipleAnswers: true }));
        /**
         * You can provide a custom message secret, it can be used as a poll ID:
         * @note It has to be a unique vector with a length of 32
         */
        await msg.reply(
            new Poll('Cats or Dogs?', ['Cats', 'Dogs'], {
                messageSecret: [
                    1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
                ]
            })
        );
    } else if (msg.body === '!edit') {
        if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg.fromMe) {
                quotedMsg.edit(msg.body.replace('!edit', ''));
            } else {
                msg.reply('I can only edit my own messages');
            }
        }
    } else if (msg.body === '!updatelabels') {
        const chat = await msg.getChat();
        await chat.changeLabels([0, 1]);
    } else if (msg.body === '!addlabels') {
        const chat = await msg.getChat();
        let labels = (await chat.getLabels()).map((l) => l.id);
        labels.push('0');
        labels.push('1');
        await chat.changeLabels(labels);
    } else if (msg.body === '!removelabels') {
        const chat = await msg.getChat();
        await chat.changeLabels([]);
    } else if (msg.body === '!approverequest') {
        /**
         * Presented an example for membership request approvals, the same examples are for the request rejections.
         * To approve the membership request from a specific user:
         */
        await client.approveGroupMembershipRequests(msg.from, { requesterIds: 'number@c.us' });
        /** The same for execution on group object (no need to provide the group ID): */
        const group = await msg.getChat();
        await group.approveGroupMembershipRequests({ requesterIds: 'number@c.us' });
        /** To approve several membership requests: */
        const approval = await client.approveGroupMembershipRequests(msg.from, {
            requesterIds: ['number1@c.us', 'number2@c.us']
        });
        /**
         * The example of the {@link approval} output:
         * [
         *   {
         *     requesterId: 'number1@c.us',
         *     message: 'Rejected successfully'
         *   },
         *   {
         *     requesterId: 'number2@c.us',
         *     error: 404,
         *     message: 'ParticipantRequestNotFoundError'
         *   }
         * ]
         *
         */
        console.log(approval);
        /** To approve all the existing membership requests (simply don't provide any user IDs): */
        await client.approveGroupMembershipRequests(msg.from);
        /** To change the sleep value to 300 ms: */
        await client.approveGroupMembershipRequests(msg.from, {
            requesterIds: ['number1@c.us', 'number2@c.us'],
            sleep: 300
        });
        /** To change the sleep value to random value between 100 and 300 ms: */
        await client.approveGroupMembershipRequests(msg.from, {
            requesterIds: ['number1@c.us', 'number2@c.us'],
            sleep: [100, 300]
        });
        /** To explicitly disable the sleep: */
        await client.approveGroupMembershipRequests(msg.from, {
            requesterIds: ['number1@c.us', 'number2@c.us'],
            sleep: null
        });
    } else if (msg.body === '!pinmsg') {
        /**
         * Pins a message in a chat, a method takes a number in seconds for the message to be pinned.
         * WhatsApp default values for duration to pass to the method are:
         * 1. 86400 for 24 hours
         * 2. 604800 for 7 days
         * 3. 2592000 for 30 days
         * You can pass your own value:
         */
        const result = await msg.pin(60); // Will pin a message for 1 minute
        console.log(result); // True if the operation completed successfully, false otherwise
    } else if (msg.body === '!howManyConnections') {
        /**
         * Get user device count by ID
         * Each WaWeb Connection counts as one device, and the phone (if exists) counts as one
         * So for a non-enterprise user with one WaWeb connection it should return "2"
         */
        let deviceCount = await client.getContactDeviceCount(msg.from);
        await msg.reply(`You have *${deviceCount}* devices connected`);
    } else if (msg.body === '!syncHistory') {
        const isSynced = await client.syncHistory(msg.from);
        // Or through the Chat object:
        // const chat = await client.getChatById(msg.from);
        // const isSynced = await chat.syncHistory();
        
        await msg.reply(isSynced ? 'Historical chat is syncing..' : 'There is no historical chat to sync.');
    } else if (msg.body === '!statuses') {
        const statuses = await client.getBroadcasts();
        console.log(statuses);
        const chat = await statuses[0]?.getChat(); // Get user chat of a first status
        console.log(chat);
    } else if (msg.body === '!sendMediaHD' && msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            const media = await quotedMsg.downloadMedia();
            await client.sendMessage(msg.from, media, { sendMediaAsHd: true });
        }
    } else if (msg.body === '!parseVCard') {
        const vCard =
            'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN:John Doe\n' +
            'ORG:Microsoft;\n' +
            'EMAIL;type=INTERNET:john.doe@gmail.com\n' +
            'URL:www.johndoe.com\n' +
            'TEL;type=CELL;type=VOICE;waid=18006427676:+1 (800) 642 7676\n' +
            'END:VCARD';
        const vCardExtended =
            'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN:John Doe\n' +
            'ORG:Microsoft;\n' +
            'item1.TEL:+1 (800) 642 7676\n' +
            'item1.X-ABLabel:USA Customer Service\n' +
            'item2.TEL:+55 11 4706 0900\n' +
            'item2.X-ABLabel:Brazil Customer Service\n' +
            'PHOTO;BASE64:here you can paste a binary data of a contact photo in Base64 encoding\n' +
            'END:VCARD';
        const userId = 'XXXXXXXXXX@c.us';
        await client.sendMessage(userId, vCard);
        await client.sendMessage(userId, vCardExtended);
    } else if (msg.body === '!changeSync') {
        // NOTE: this action will take effect after you restart the client.
        const backgroundSync = await client.setBackgroundSync(true);
        console.log(backgroundSync);
    }
});

client.on('message_create', async (msg) => {
    // Fired on all message creations, including your own
    if (msg.fromMe) {
        // do stuff here
    }

    // Unpins a message
    if (msg.fromMe && msg.body.startsWith('!unpin')) {
        const pinnedMsg = await msg.getQuotedMessage();
        if (pinnedMsg) {
            // Will unpin a message
            const result = await pinnedMsg.unpin();
            console.log(result); // True if the operation completed successfully, false otherwise
        }
    }
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

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
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
