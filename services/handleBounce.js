// services/handleBounce.js
import User from '../models/User.js';       // change to your path
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
    console.log('result', result); // this console is running but i don't see any update object in Invite schema 
    // result[
    //     {
    //         status: 'fulfilled',
    //         value: {
    //             acknowledged: true,
    //             modifiedCount: 1,
    //             upsertedId: null,
    //             upsertedCount: 0,
    //             matchedCount: 1
    //         }
    //     }
    // ]
    return result;
}