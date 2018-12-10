const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const {transport, makeANiceEmail} = require('../mail');

const Mutations = {
    async createItem(parent, args, ctx, info) {
        // TODO check if they are logged in
        const item = await ctx.db.mutation.createItem({
            data: {
                ...args
            }
        }, info);
        return item;
    },
    async updateItem(parent, args, ctx, info) {
        // frist take a copy of the updates 
        const updates = { ...args };
        // remove the id from the updates
        delete updates.id;
        return await ctx.db.mutation.updateItem({
            data: updates,
            where: {
                id: args.id
            }
        }, info);
    },
    async deleteItem(parent, args, ctx, info) {
        const where = { id: args.id }
        // find the item
        const item = await ctx.db.query.item({ where }, `{ id title }`)
        // check if they own that item 
        // delete it
        return ctx.db.mutation.deleteItem({ where }, info);
    },
    async signup(parent, args, ctx, info) {
        //lowercase their email
        args.email = args.email.toLowerCase();
        // hash their password
        const password = await bcrypt.hash(args.password, 10);
        // create user in the database
        const user = await ctx.db.mutation.createUser({
            data: {
                ...args,
                password,
                permissions: { set: ['USER'] },
            }
        }, info);
        // create jwt token
        const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
        // we set the jwt as a cookie on the response 
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
        });
        // finally return the user
        return user;
    },
    async signin(parent, { password, email }, ctx, info) {
        // 1. check if there is a user with that email
        const user = await ctx.db.query.user({ where: { email } });
        if (!user) {
            throw new Error(`No user with such found for user ${email}`);
        }
        // 2. check if their password is correct
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            throw new Error('Invalid Password');
        }
        // 3. generate the JWT Token
        const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
        // 4. Set the cookie with the token
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
        });
        // 5. Return the user
        return user;
    },
    signout(parent, args, ctx, info) {
        ctx.response.clearCookie('token');
        return { message: 'Goodbye!' }
    },
    async requestReset(parent, args, ctx, info) {
        // 1. check if this is a real user
        const user = await ctx.db.query.user({ where: { email: args.email } });
        if (!user) {
            throw new Error(`No user with such found for user ${args.email}`);
        }
        // 2. set a reset token on that user
        const resetToken = (await promisify(randomBytes)(20)).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000;
        const res = await ctx.db.mutation.updateUser({
            where: {email: args.email},
            data: {resetToken: resetToken, resetTokenExpiry: resetTokenExpiry}
        });
        // 3. email them that reset token
        const mailRes = await transport.sendMail({
            from: 'benjamindaniel706@gmail.com',
            to: user.email,
            subject: "Your Password Reset Token",
            html: makeANiceEmail(`Your password Reset Token is here! 
            \n\n
            <a href="${process.env.
                FRONTEND_URL}/reset?resetToken=${resetToken}">
                Click Here to reset
            </a>`)
        });
        // 4. return the message
        return {message: "Thanks!"}
    },
    async resetPassword(parent, args, ctx, info) {
        // 1. Check if the password match
        if (args.password !== args.confirmPassword) {
            throw new Error('Yo password don\'t match');
        }
        // 2. check if its is a legit reset Token
        // 3. Check if it is  expired 
        const [user] = await ctx.db.query.users({
            where: {
                resetToken: args.resetToken,
                resetTokenExpiry_gte: Date.now() - 3600000,
            },
        });
        if (!user) {
            throw new Error('This token is either expired or invalid');
        };
        // 4. Hash there new Password
        const password = await bcrypt.hash(args.password, 10);
        // 5. save the new password to the user and remove old resetToken fields
        const updatedUser = await ctx.db.mutation.updateUser({
            where: {email: user.email},
            data: {
                password,
                resetToken: null,
                resetTokenExpiry: null,
            }
        });
        // 6. Generate jwt
        const token = jwt.sign({userId: updatedUser.id},process.env.APP_SECRET);
        // 7. set the jwt cookie
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
        });
        // 8. return the user
        return updatedUser;

    },

};

module.exports = Mutations;
