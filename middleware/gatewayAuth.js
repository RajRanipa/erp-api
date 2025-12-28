export default function gatewayAuth(req, res, next) {
  const key = req.header("X-Gateway-Key");
  if (!key || key !== process.env.GATEWAY_KEY) {
    return res.status(401).json({ message: "Unauthorized gateway" });
  }
  next();
}