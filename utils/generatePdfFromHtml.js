import puppeteer from 'puppeteer';

export default async function generatePdfFromHtml(html) {
    if (!html || typeof html !== 'string') {
        throw new Error(
            'Valid HTML is required to generate the PDF',
        );
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
        });

        const page = await browser.newPage();

        await page.setContent(
            `
                <!DOCTYPE html>
                <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta
                            name="viewport"
                            content="width=device-width, initial-scale=1.0"
                        >

                        <style>
                            * {
                                box-sizing: border-box;
                            }

                            body {
                                margin: 0;
                                padding: 24px;
                                background: white;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                        </style>
                    </head>

                    <body>
                        ${html}
                    </body>
                </html>
            `,
            {
                waitUntil: 'networkidle0',
            },
        );

        await page.emulateMediaType('screen');

        const pdf = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: {
                top: '12mm',
                right: '10mm',
                bottom: '12mm',
                left: '10mm',
            },
        });

        return Buffer.from(pdf);
    } catch (error) {
        throw new Error(
            'Failed to generate production report PDF',
            {
                cause: error,
            },
        );
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}