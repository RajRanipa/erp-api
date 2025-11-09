// services/handleBounce.js
import Invite from '../models/Invite.js';   // change to your path

export async function handleBounce({ recipient, status, category }) {
    const update = {
        emailStatus: category === 'hard' ? 'bounced' : 'undeliverable',
        emailStatusCode: status || null,
        bouncedAt: new Date(),
    };
    // Try both collections; adapt to your schema
    const result = await Promise.allSettled([
        // User.updateMany({ email: recipient }, { $set: update }),
        Invite.updateMany({ email: recipient }, { $set: update }),
    ]);
    // console.log('result', result); 
    return result;
}