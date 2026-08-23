// As rotas Express (routes/*.js) são montadas antes do socket.io ser criado
// em server.js, e server.js importa as rotas — então as rotas não podem
// importar `io` direto de server.js sem criar um import circular. Este
// módulo serve só de "caixa de correio" pra isso: server.js chama
// initRealtime(io) assim que o socket.io existe, e qualquer rota que
// precise notificar um cliente em tempo real chama getIO().
let ioInstance = null;

export function initRealtime(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}
