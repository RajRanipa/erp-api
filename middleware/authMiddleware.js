import jwt from 'jsonwebtoken';

const verifyAccessToken = (req, res, next) => {
  const token = req.cookies.accessToken;


  console.log("authMiddleware file here ")
  console.log(!token)

  if (!token) {
    console.log(" authMiddleware file here false ")
    return res.status(401).json({ message: 'Unauthorized: No access token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log("Decoded of Middleware")
    console.log(decoded)
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Forbidden: Invalid or expired access token.' });
  }
};

export default verifyAccessToken;