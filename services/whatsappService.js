// service/whatsappService.js

// sendTextMessage()
// uploadDocument()
// sendDocumentMessage()


function getWhatsAppConfig() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';

    if (!accessToken) {
        throw new Error('WHATSAPP_ACCESS_TOKEN is missing');
    }

    if (!phoneNumberId) {
        throw new Error('WHATSAPP_PHONE_NUMBER_ID is missing');
    }

    return {
        accessToken,
        phoneNumberId,
        apiVersion,
    };
}

export async function sendTextMessage({
    to,
    text,
}) {
    if (!to) {
        throw new Error('WhatsApp recipient number is required');
    }

    if (!text) {
        throw new Error('WhatsApp message text is required');
    }

    const {
        accessToken,
        phoneNumberId,
        apiVersion,
    } = getWhatsAppConfig();


    const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: String(to).replace(/\D/g, ''),
                type: 'text',
                text: {
                    preview_url: false,
                    body: text,
                },
            }),
        },
    );

    const data = await response.json();

    if (!response.ok) {
        console.error(
            'WhatsApp API Error:',
            data,
        );

        throw new Error(
            data?.error?.message || 'WhatsApp API request failed',
        );
    }

    return data;
}

export async function uploadMedia({
    buffer,
    filename,
}) {
    if (!buffer) {
        throw new Error('Media buffer is required');
    }

    if (!filename) {
        throw new Error('Filename is required');
    }

    const {
        accessToken,
        phoneNumberId,
        apiVersion,
    } = getWhatsAppConfig();

    const form = new FormData();

    form.append('messaging_product', 'whatsapp');
    form.append(
        'file',
        new Blob([buffer], { type: 'application/pdf' }),
        filename,
    );

    const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: form,
        },
    );

    const data = await response.json();

    if (!response.ok) {
        console.error(
            'WhatsApp Doc Upload Error:',
            data,
        );

        throw new Error(
            data?.error?.message || 'WhatsApp media upload failed',
        );
    }

    console.log(`WhatsApp media uploaded: ${data.id}`);

    return data.id;
}

export async function sendDocument({
    to,
    mediaId,
    filename,
    caption = '',
}) {
    if (!to) {
        throw new Error('Recipient number is required');
    }

    if (!mediaId) {
        throw new Error('Media ID is required');
    }
    try {
        const {
            accessToken,
            phoneNumberId,
            apiVersion,
        } = getWhatsAppConfig();

        const response = await fetch(
            `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: String(to).replace(/\D/g, ''),
                    type: 'document',
                    document: {
                        id: mediaId,
                        filename,
                        caption,
                    },
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            console.error(data);

            throw new Error(
                data?.error?.message || 'WhatsApp document send failed',
            );
        }

        console.log(`✅ WhatsApp document sent to ${to}`,);
        console.log(
            `WhatsApp message id: ${data.messages?.[0]?.id}`,
        );

        return data;
    } catch (error) {
        console.error(
            'WhatsApp document send failed:',
            error,
        );

        throw error;
    }
}

export async function sendProductionReport({
    to,
    summary,
    pdfBuffer,
    filename,
    shift
}) {
    if (!to) {
        throw new Error('Recipient number is required');
    }

    if (!summary) {
        throw new Error('Report summary is required');
    }

    if (!pdfBuffer) {
        throw new Error('PDF buffer is required');
    }

    if (!filename) {
        throw new Error('Filename is required');
    }
    try {

        // 1. Send summary message
        await sendTextMessage({
            to,
            text: summary,
        });

        // 2. Upload PDF to WhatsApp
        const mediaId = await uploadMedia({
            buffer: pdfBuffer,
            filename,
        });

        // 3. Send uploaded PDF
        return await sendDocument({
            to,
            mediaId,
            filename,
            caption: `JNR ERP ${shift} Shift Production Report`,
        });
    } catch (err) {
        console.error('WhatsApp production report failed', err);
        throw err;
    }
}

// caption: `JNR ERP ${shift} Shift Production Report`