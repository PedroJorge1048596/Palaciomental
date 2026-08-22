import jwt from "jsonwebtoken";

// Em produção, DEFINA a variável de ambiente JWT_SECRET com um valor único e secreto
// (ex: gere um com `openssl rand -hex 32`). Sem isso, qualquer pessoa que veja o código
// consegue forjar tokens de login.
export const JWT_SECRET = process.env.JWT_SECRET || "troque-este-segredo-em-producao"; // fallback simples para ambiente local de estudo

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Não autenticado" });
  const token = header.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

export function verifySocketToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
