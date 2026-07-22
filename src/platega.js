import { logPaymentFailure } from './database.js';
const API_URL = 'https://app.platega.io'; 

export async function createPlategaInvoice(amount, paymentMethod, payloadStr) {
    try {
        // Формируем тело запроса заранее, чтобы вывести его в лог
        const requestBody = {
            paymentMethod: parseInt(paymentMethod, 10), // Жестко гарантируем, что это число
            paymentDetails: {
                amount: amount,
                currency: "RUB"
            },
            description: "Оплата пакета",
            return: "https://t.me/evaflirt_bot", 
            failedUrl: "https://t.me/evaflirt_bot",
            payload: payloadStr
        };

        // ВЫВОДИМ В КОНСОЛЬ ТО, ЧТО УЛЕТАЕТ В PLATEGA
        console.log("=== ОТПРАВЛЯЕМ ЗАПРОС В PLATEGA ===", JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${API_URL}/transaction/process`, {
            method: "POST",
            headers: {
                "X-MerchantId": process.env.PLATEGA_MERCHANT_ID,
                "X-Secret": process.env.PLATEGA_SECRET,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("[Platega] Ошибка создания:", errText);
            await logPaymentFailure(`Platega Create Error: ${errText}`);
            return null;
        }
        
        const data = await response.json();
        console.log("=== ОТВЕТ ОТ PLATEGA ===", data); 
        return data;
    } catch (e) {
        console.error("[Platega] Ошибка сети:", e);
        return null;
    }
}

export async function checkPlategaInvoice(transactionId) {
    try {
        const response = await fetch(`${API_URL}/transaction/${transactionId}`, {
            method: "GET",
            headers: {
                "X-MerchantId": process.env.PLATEGA_MERCHANT_ID,
                "X-Secret": process.env.PLATEGA_SECRET
            }
        });

        if (!response.ok) {
            console.error(`[Platega Check] Ошибка ${response.status}:`, await response.text());
            return null;
        }

        const data = await response.json();
        console.log("=== ОТВЕТ PLATEGA ПРИ ПРОВЕРКЕ ===", data);
        return data; // Возвращаем объект со статусом
    } catch (e) {
        console.error("[Platega] Ошибка сети при проверке:", e);
        return null;
    }
}