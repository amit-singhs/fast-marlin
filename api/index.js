"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const fastify_1 = __importDefault(require("fastify"));
const apiKeyAuthMiddleware_1 = __importDefault(require("./middlewares/apiKeyAuthMiddleware"));
const jsonwebtoken_1 = require("jsonwebtoken");
const supabaseClient_1 = __importDefault(require("./supabaseClient"));
const jwtUtils_1 = require("./utils/jwtUtils");
const emailUtils_1 = require("./utils/emailUtils");
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const cors_1 = __importDefault(require("@fastify/cors"));
const app = (0, fastify_1.default)({
    logger: true,
    maxParamLength: 300,
});
// Register the CORS plugin after cookies and rate limiting
app.register(cors_1.default, {
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    exposedHeaders: ["Set-Cookie"],
    maxAge: 86400,
});
/*app.register(fastifyCors, {
  origin: "http://localhost:5173", // Frontend origin
  credentials: true, // Allow cookies to be sent
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Allowed HTTP methods
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "Accept",
    "User-Agent",
    "Referer",
    "Accept-Language",
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
  ], // Allowed headers
  maxAge: 86400, // 24 hours
});*/
// Register the rate limiting plugin first
app.register(rate_limit_1.default, {
    max: 1, // Maximum 1 requests
    timeWindow: "1 minute", // Per minute
    keyGenerator: (request) => {
        return request.ip; // Rate limit based on the client's IP address
    },
    global: false, // Apply to all routes
});
// Register the middleware
app.addHook("onRequest", apiKeyAuthMiddleware_1.default);
app.register(cookie_1.default, {
    secret: process.env.COOKIE_SECRET,
    parseOptions: {}, // options for parsing cookies
});
// Define a route to test the server
app.get("/hello", (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply.status(200).type("text/plain").send("Hello, World!");
}));
app.get("/welcome", (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply
        .status(200)
        .type("text/plain")
        .send("Hello Universe, we welcome you all !!");
}));
// Define the root route
app.get("/", (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply.status(200).type("text/html").send(html);
}));
// The login route, through email
app.post("/login", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = request.body;
    if (!email) {
        return reply.status(400).send({ error: "Email is required" });
    }
    const { data: existingData, error: fetchError } = yield supabaseClient_1.default
        .from("users")
        .select("*")
        .eq("email", email)
        .single();
    if (fetchError && fetchError.code !== "PGRST116") {
        return reply.status(500).send({
            error: "Error fetching email data",
            details: fetchError.message,
        });
    }
    if (fetchError && fetchError.code === "PGRST116") {
        return reply
            .status(404)
            .send({ error: "Email not registered in the app." });
    }
    if (existingData) {
        if (!existingData.verified) {
            return reply.status(403).send({
                error: "The email is not verified.",
            });
        }
        let newToken = "";
        try {
            newToken = (0, jwtUtils_1.generateToken)({ email, id: existingData.id }, "1h");
            // Set the cookie
            reply.setCookie("access-token", newToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production", // Set to true in production
                path: "/", // Make cookie accessible in all routes
                sameSite: "lax",
            });
            return reply.send({ status: "success" });
        }
        catch (error) {
            console.error("Token generation error: ", error);
            return reply.status(500).send({ error: "Internal Server Error" });
        }
    }
}));
app.post("/update-token", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = request.body;
    // Check if the email is provided
    if (!email) {
        return reply.status(400).send({ error: "Email is required" });
    }
    // Query Supabase for the email
    const { data: existingData, error: fetchError } = yield supabaseClient_1.default
        .from("users")
        .select("*")
        .eq("email", email)
        .single();
    if (fetchError && fetchError.code !== "PGRST116") {
        // Handle errors other than 'no rows found'
        return reply.status(500).send({
            error: "Error fetching email data",
            details: fetchError.message,
        });
    }
    if (fetchError && fetchError.code === "PGRST116") {
        // Email not found
        return reply
            .status(404)
            .send({ error: "Email not registered in the app." });
    }
    if (existingData) {
        // Check if the email is verified
        if (!existingData.verified) {
            return reply.status(403).send({
                error: "The email is not verified, hence token cannot be updated.",
            });
        }
        // Generate a new token
        try {
            const newToken = (0, jwtUtils_1.generateToken)({ email }, "1h");
            // Update Supabase with the new token
            const { data: updatedData, error: updateError } = yield supabaseClient_1.default
                .from("users")
                .update({ token: newToken })
                .eq("email", email)
                .select();
            if (updateError) {
                return reply.status(500).send({
                    error: "Error updating token",
                    details: updateError.message,
                });
            }
            // Send the response with the updated data
            return reply.send({ status: "success", data: updatedData });
        }
        catch (error) {
            console.error("Unexpected error while generating token:", error);
            return reply.status(500).send({ error: "Internal Server Error" });
        }
    }
}));
app.post("/send-verification", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = request.body;
    if (!email) {
        return reply.status(400).send({ error: "Email is required" });
    }
    // Generate a token
    const token = (0, jwtUtils_1.generateToken)({ email }, "1h");
    // Insert the email and token in Supabase
    const { error: supabaseError } = yield supabaseClient_1.default
        .from("users")
        .insert([{ email, token }])
        .select();
    if (supabaseError) {
        return reply.status(500).send({
            error: "Error updating or inserting email into Supabase",
            details: supabaseError.message,
        });
    }
    // Create the verification link
    const verificationLink = `http://localhost:3000/verify-email/${email}/${token}`;
    const subject = "Email Verification";
    const text = `Please verify your email by clicking on the following link: ${verificationLink}`;
    try {
        // Send the verification email
        yield (0, emailUtils_1.sendEmail)(email, subject, text);
        return reply.send({
            status: "success",
            message: "Verification email sent",
        });
    }
    catch (mailError) {
        return reply.status(500).send({
            error: "Error sending verification email",
            details: mailError,
        });
    }
}));
app.get("/verify-email/:email/:token", {
    config: {
        rateLimit: {
            max: 1, // Maximum 1 requests
            timeWindow: "1 minute", // Per minute
        },
    },
}, (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, token } = request.params;
    try {
        // Check if email exists
        const { data: existingData, error: fetchError } = yield supabaseClient_1.default
            .from("users")
            .select("*")
            .eq("email", email)
            .single();
        if (fetchError || !existingData) {
            return reply.status(404).send({ error: "Email not found" });
        }
        if (existingData.verified) {
            return reply.status(400).send({
                error: "Email is already verified, please proceed to use the app.",
            });
        }
        // Check if token matches
        if (existingData.token !== token) {
            return reply.status(400).send({ error: "Faulty token" });
        }
        // Check token expiration
        const decodedToken = (yield (0, jwtUtils_1.verifyToken)(token));
        if (decodedToken.exp === undefined) {
            return reply
                .status(400)
                .send({ error: "Token does not have an expiration time" });
        }
        if (decodedToken.exp * 1000 < Date.now()) {
            return reply.status(400).send({
                error: "Token is expired, please resend verification link",
            });
        }
        // Token is still valid, update 'verified' flag
        const { data: updatedData, error: updateError } = yield supabaseClient_1.default
            .from("users")
            .update({ verified: true })
            .eq("email", email)
            .select();
        if (updateError) {
            return reply
                .status(500)
                .send({ error: "Failed to update verification status" });
        }
        return reply.send({ status: "success", data: updatedData });
    }
    catch (error) {
        // Handle specific token errors
        if (error instanceof jsonwebtoken_1.TokenExpiredError) {
            return reply.status(401).send({
                error: "The token is expired, please request another verification link.",
            });
        }
        // Handle other potential errors
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
// Define the route
app.post("/upsert-testator", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
        return reply
            .status(401)
            .send({ error: "Authorization header is missing" });
    }
    // Check if the Authorization header has the Bearer token
    const token = authHeader.split(" ")[1];
    if (!token) {
        return reply.status(401).send({ error: "Bearer token is missing" });
    }
    // Decode and verify the token
    let decodedToken;
    try {
        decodedToken = yield (0, jwtUtils_1.verifyToken)(token); // Replace with your actual secret key
    }
    catch (err) {
        return reply.status(401).send({ error: "Invalid token" });
    }
    // Extract user ID from the token
    const userId = decodedToken.id;
    if (!userId) {
        return reply.status(401).send({ error: "Invalid token payload" });
    }
    // Extract and validate the request body
    const { full_name, father_name, date_of_birth, nationality, address, will_declaration, } = request.body;
    if (!full_name ||
        !father_name ||
        !date_of_birth ||
        !nationality ||
        !address ||
        !will_declaration) {
        return reply
            .status(400)
            .send({ error: "Missing required fields in the request body" });
    }
    // Parse the date_of_birth to a date object
    const parsedDate = new Date(date_of_birth);
    if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: "Invalid date_of_birth format" });
    }
    // Prepare the data to upsert
    const upsertData = {
        user_id: userId,
        full_name,
        father_name,
        date_of_birth: parsedDate.toISOString().split("T")[0], // Format as 'YYYY-MM-DD'
        nationality,
        address,
        will_declaration,
    };
    try {
        // Perform the upsert operation
        const { data, error } = yield supabaseClient_1.default
            .from("testators")
            .upsert(upsertData, { onConflict: "user_id" }) // Upsert based on user_id
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply
                .status(500)
                .send({ error: "Database error", details: error.message });
        }
        // Return the inserted/updated data
        return reply.status(200).send({ status: "success", id: data[0].id });
    }
    catch (err) {
        console.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
app.post("/upsert-executor", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
        return reply
            .status(401)
            .send({ error: "Authorization header is missing" });
    }
    // Check if the Authorization header has the Bearer token
    const tokenParts = authHeader.split(" ");
    if (tokenParts[0] !== "Bearer" || !tokenParts[1]) {
        return reply.status(401).send({ error: "Bearer token is missing" });
    }
    const token = tokenParts[1];
    // Decode and verify the token
    let decodedToken;
    try {
        decodedToken = yield (0, jwtUtils_1.verifyToken)(token); // Replace with your actual secret key
    }
    catch (err) {
        return reply.status(401).send({ error: "Invalid token" });
    }
    // Extract user ID from the token
    const userId = decodedToken.id;
    if (!userId) {
        return reply.status(401).send({ error: "Invalid token payload" });
    }
    // Extract and validate the request body
    const { full_name, father_name, date_of_birth, nationality, address, consent, } = request.body;
    if (!full_name ||
        !father_name ||
        !date_of_birth ||
        !nationality ||
        !address ||
        consent === undefined) {
        return reply.status(400).send({
            error: "Missing required fields in the request body",
        });
    }
    // Validate the consent field
    if (typeof consent !== "string") {
        return reply.status(400).send({
            error: "Invalid consent value; it should be a boolean",
        });
    }
    // Parse the date_of_birth to a date object
    const parsedDate = new Date(date_of_birth);
    if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: "Invalid date_of_birth format" });
    }
    // Prepare the data to upsert
    const upsertData = {
        user_id: userId,
        full_name,
        father_name,
        date_of_birth: parsedDate.toISOString().split("T")[0], // Format as 'YYYY-MM-DD'
        nationality,
        address,
        consent,
    };
    try {
        // Perform the upsert operation
        const { data, error } = yield supabaseClient_1.default
            .from("executors")
            .upsert(upsertData, { onConflict: "user_id" }) // Upsert based on user_id
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply.status(500).send({
                error: "Database error",
                details: error.message,
            });
        }
        // Check if data was returned
        if (data && data.length > 0) {
            return reply.status(200).send({ status: "success", id: data[0].id });
        }
        else {
            return reply
                .status(500)
                .send({ error: "Failed to upsert executor data" });
        }
    }
    catch (err) {
        console.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
// Define the route
app.post("/upsert-beneficiary", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
        return reply
            .status(401)
            .send({ error: "Authorization header is missing" });
    }
    // Check if the Authorization header has the Bearer token
    const tokenParts = authHeader.split(" ");
    if (tokenParts[0] !== "Bearer" || !tokenParts[1]) {
        return reply.status(401).send({ error: "Bearer token is missing" });
    }
    const token = tokenParts[1];
    // Decode and verify the token
    let decodedToken;
    try {
        decodedToken = yield (0, jwtUtils_1.verifyToken)(token); // Replace with your actual secret key
    }
    catch (err) {
        return reply.status(401).send({ error: "Invalid token" });
    }
    // Extract user ID from the token
    const userId = decodedToken.id;
    if (!userId) {
        return reply.status(401).send({ error: "Invalid token payload" });
    }
    // Extract and validate the request body
    const { id, // Optional, for upserting existing beneficiaries
    full_name, father_name, date_of_birth, relationship_with_testator, address, share, } = request.body;
    if (!full_name ||
        !father_name ||
        !date_of_birth ||
        !relationship_with_testator ||
        !address ||
        share === undefined) {
        return reply.status(400).send({
            error: "Missing required fields in the request body",
        });
    }
    // Parse the date_of_birth to a date object
    const parsedDate = new Date(date_of_birth);
    if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: "Invalid date_of_birth format" });
    }
    // Prepare the data to upsert
    const upsertData = {
        user_id: userId,
        full_name,
        father_name,
        date_of_birth: parsedDate.toISOString().split("T")[0], // Format as 'YYYY-MM-DD'
        relationship_with_testator,
        address,
        share,
    };
    // Include the id if it's provided
    if (id) {
        upsertData.id = id;
    }
    try {
        // Perform the upsert operation
        const { data, error } = yield supabaseClient_1.default
            .from("beneficiaries")
            .upsert(upsertData, { onConflict: "user_id" }) // Upsert based on id
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply.status(500).send({
                error: "Database error",
                details: error.message,
            });
        }
        // Check if data was returned
        if (data && data.length > 0) {
            return reply.status(200).send({ status: "success", id: data[0].id });
        }
        else {
            return reply
                .status(500)
                .send({ error: "Failed to upsert beneficiary data" });
        }
    }
    catch (err) {
        console.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
// Define the route
app.post("/upsert-witness", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
        return reply
            .status(401)
            .send({ error: "Authorization header is missing" });
    }
    // Check if the Authorization header has the Bearer token
    const tokenParts = authHeader.split(" ");
    if (tokenParts[0] !== "Bearer" || !tokenParts[1]) {
        return reply.status(401).send({ error: "Bearer token is missing" });
    }
    const token = tokenParts[1];
    // Decode and verify the token
    let decodedToken;
    try {
        decodedToken = yield (0, jwtUtils_1.verifyToken)(token); // Replace with your actual secret key
    }
    catch (err) {
        return reply.status(401).send({ error: "Invalid token" });
    }
    // Extract user ID from the token
    const userId = decodedToken.id;
    if (!userId) {
        return reply.status(401).send({ error: "Invalid token payload" });
    }
    // Extract and validate the request body
    const { id, // Optional, for upserting existing witnesses
    full_name, father_name, address, contact, email, } = request.body;
    if (!full_name || !father_name || !address || !contact || !email) {
        return reply.status(400).send({
            error: "Missing required fields in the request body",
        });
    }
    // Validate the email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return reply.status(400).send({
            error: "Invalid email format",
        });
    }
    // Prepare the data to upsert
    const upsertData = {
        user_id: userId,
        full_name,
        father_name,
        address,
        contact,
        email,
    };
    // Include the id if it's provided
    if (id) {
        upsertData.id = id;
    }
    try {
        // Perform the upsert operation
        const { data, error } = yield supabaseClient_1.default
            .from("witnesses")
            .upsert(upsertData, { onConflict: "user_id" }) // Upsert based on id
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply.status(500).send({
                error: "Database error",
                details: error.message,
            });
        }
        // Check if data was returned
        if (data && data.length > 0) {
            return reply.status(200).send({ status: "success", id: data[0].id });
        }
        else {
            return reply
                .status(500)
                .send({ error: "Failed to upsert witness data" });
        }
    }
    catch (err) {
        console.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_TEST_KEY_ID,
    key_secret: process.env.RAZORPAY_TEST_KEY_SECRET,
});
// Define the route
app.post("/create-order", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
        return reply.status(401).send({ error: "Authorization header is missing" });
    }
    const tokenParts = authHeader.split(" ");
    if (tokenParts[0] !== "Bearer" || !tokenParts[1]) {
        return reply.status(401).send({ error: "Bearer token is missing" });
    }
    const token = tokenParts[1];
    // Decode and verify the token
    let decodedToken;
    try {
        decodedToken = yield (0, jwtUtils_1.verifyToken)(token);
    }
    catch (err) {
        return reply.status(401).send({ error: "Invalid token" });
    }
    // Extract user ID from the token
    const userId = decodedToken.id;
    if (!userId) {
        return reply.status(401).send({ error: "Invalid token payload" });
    }
    const amount = 532; // TODO: This is a backend hard coded amount
    const receipt = `receipt_${new Date().getTime()}`;
    try {
        // Create an order using Razorpay API
        const options = {
            amount: amount * 100, // Amount in paise
            currency: "INR",
            receipt: receipt,
            payment_capture: 1, // Auto-capture payment
        };
        const order = yield razorpay.orders.create(options);
        // Insert the order details into the transactions table
        const { data, error } = yield supabaseClient_1.default
            .from("transactions")
            .insert([
            {
                user_id: userId,
                order_id: order.id,
                amount,
                currency: "INR",
                status: order.status,
                receipt: order.receipt,
            },
        ])
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply
                .status(500)
                .send({ error: "Database error", details: error.message });
        }
        // Return the order details to the frontend
        return reply.status(200).send({ order });
    }
    catch (err) {
        console.error("Razorpay error:", err);
        return reply.status(500).send({ error: "Razorpay error", details: err });
    }
}));
app.post("/verify-payment", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    // Extract the Authorization header (optional, if needed)
    const authHeader = request.headers["authorization"];
    // Optionally verify the user as before...
    // Extract and validate the request body
    const { order_id, payment_id, signature } = request.body;
    if (!order_id || !payment_id || !signature) {
        return reply.status(400).send({ error: "Missing required fields" });
    }
    // Generate the expected signature
    const generatedSignature = crypto_1.default
        .createHmac("sha256", process.env.RAZORPAY_TEST_KEY_SECRET)
        .update(order_id + "|" + payment_id)
        .digest("hex");
    // Compare the signatures
    if (generatedSignature !== signature) {
        return reply.status(400).send({ error: "Invalid payment signature" });
    }
    try {
        // Update the transaction status in the database
        const { data, error } = yield supabaseClient_1.default
            .from("transactions")
            .update({ payment_id, status: "paid" })
            .eq("order_id", order_id)
            .select();
        if (error) {
            console.error("Supabase error:", error);
            return reply
                .status(500)
                .send({ error: "Database error", details: error.message });
        }
        // Return success response
        return reply
            .status(200)
            .send({ status: "Payment verified successfully" });
    }
    catch (err) {
        console.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
app.get("/user-data", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("All request headers:", request.headers);
    console.log("Cookie header:", request.headers.cookie);
    console.log("Parsed cookies:", request.cookies);
    try {
        console.log("From user-data, line 988, ALL COOKIES, request.cookies are is ccccccccccccccccccccc> : ", request.cookies);
        // Extract the 'access-token' from the cookies
        const accessToken = request.cookies["access-token"];
        console.log("From user-data, line 973, accessToken is ------------------> : ", accessToken);
        if (!accessToken) {
            return reply
                .status(401)
                .send({ error: "Unauthorized: No access token found." });
        }
        // Decode and verify the token
        let decodedToken;
        try {
            decodedToken = (yield (0, jwtUtils_1.verifyToken)(accessToken));
            console.log("From user-data, line 983, decodedToken is -%%%%%%%%%%%%%%> : ", decodedToken);
        }
        catch (err) {
            request.log.error("Token verification failed:", err);
            return reply.status(401).send({ error: "Invalid or expired token." });
        }
        // Extract user ID from the token
        const userId = decodedToken.id;
        if (!userId) {
            return reply.status(401).send({ error: "Invalid token payload." });
        }
        // Fetch data from Supabase
        const { data: testator, error: testatorError } = yield supabaseClient_1.default
            .from("testators")
            .select("*")
            .eq("user_id", userId)
            .single();
        if (testatorError) {
            request.log.error("Supabase testator fetch error:", testatorError);
            return reply
                .status(500)
                .send({ error: "Database error", details: testatorError.message });
        }
        const { data: executors, error: executorsError } = yield supabaseClient_1.default
            .from("executors")
            .select("*")
            .eq("user_id", userId);
        if (executorsError) {
            request.log.error("Supabase executors fetch error:", executorsError);
            return reply
                .status(500)
                .send({ error: "Database error", details: executorsError.message });
        }
        const { data: beneficiaries, error: beneficiariesError } = yield supabaseClient_1.default
            .from("beneficiaries")
            .select("*")
            .eq("user_id", userId);
        if (beneficiariesError) {
            request.log.error("Supabase beneficiaries fetch error:", beneficiariesError);
            return reply.status(500).send({
                error: "Database error",
                details: beneficiariesError.message,
            });
        }
        const { data: witnesses, error: witnessesError } = yield supabaseClient_1.default
            .from("witnesses")
            .select("*")
            .eq("user_id", userId);
        if (witnessesError) {
            request.log.error("Supabase witnesses fetch error:", witnessesError);
            return reply
                .status(500)
                .send({ error: "Database error", details: witnessesError.message });
        }
        // Construct the response object
        const responseData = {
            testator,
            executors,
            beneficiaries,
            witnesses,
        };
        return reply.status(200).send(responseData);
    }
    catch (err) {
        request.log.error("Server error:", err);
        return reply.status(500).send({ error: "Internal Server Error" });
    }
}));
// Export the Fastify instance as a Vercel function
function handler(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        yield app.ready(); // Ensure the app is ready to handle requests
        app.server.emit("request", req, res); // Emit the request to the Fastify instance
    });
}
app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    app.log.info(`Server listening at ${address}`);
});
// HTML content
const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@exampledev/new.css@1.1.2/new.min.css"
    />
    <title>Vercel + Fastify Hello World</title>
    <meta
      name="description"
      content="This is a starter template for Vercel + Fastify."
    />
  </head>
  <body>
    <h1>Vercel + Fastify Hello World</h1>
    <p>
      This is a starter template for Vercel + Fastify. Requests are
      rewritten from <code>/*</code> to <code>/api/*</code>, which runs
      as a Vercel Function.
    </p>
    <p>
        For example, here is the boilerplate code for this route:
    </p>
    <pre>
<code>import Fastify from 'fastify'

const app = Fastify({
  logger: true,
})

app.get('/', async (req, res) => {
  return res.status(200).type('text/html').send(html)
})

export default async function handler(req: any, res: any) {
  await app.ready()
  app.server.emit('request', req, res)
}</code>
    </pre>
    <p>
      <a href="https://vercel.com/templates/other/fastify-serverless-function">
      Deploy your own
      </a>
      to get started.
  </body>
</html>
`;
