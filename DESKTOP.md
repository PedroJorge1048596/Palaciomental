# App desktop (Electron) — Palácio Mental

Isso empacota o mesmo frontend React num app nativo (janela própria, ícone na área de
trabalho, sem precisar abrir navegador). Ele **não hospeda nada** — continua conversando
com o backend publicado (ver seção "Publicando online" no `README.md`). Ou seja: primeiro
publique o backend, DEPOIS gere o app desktop apontando pra URL publicada.

**Importante:** eu não consigo gerar o `.exe`/`.dmg`/`.AppImage` prontos aqui — esse
ambiente não tem acesso à internet nem roda Windows, e o `electron-builder` precisa
baixar o Electron (uns 100-200MB) e compilar pra cada sistema operacional. O que preparei
é o projeto pronto pra você (ou qualquer amigo com Node instalado) gerar o instalador na
própria máquina, em poucos comandos.

## Passo 1 — Publique o backend primeiro

Siga a seção "Publicando online" do `README.md` (Render, com disco persistente). Anote a
URL pública que você recebe, tipo `https://seu-app.onrender.com`.

## Passo 2 — Aponte o frontend pra essa URL e gere o build

```bash
cd frontend
cp .env.production.example .env.production
```

Abra `.env.production` e preencha as duas linhas com a URL do passo 1:

```
VITE_API_URL=https://seu-app.onrender.com
VITE_SOCKET_URL=https://seu-app.onrender.com
```

Depois:

```bash
npm install
npm run build
```

Isso gera `frontend/dist` — o app desktop carrega a interface a partir dali.

## Passo 3 — Instale as dependências do app desktop

```bash
cd ../desktop
npm install
```

Isso baixa o Electron e o electron-builder (é a parte demorada e pesada — internet boa
ajuda).

## Passo 4 — Testar antes de empacotar (opcional, mas recomendado)

```bash
npm start
```

Deve abrir uma janela com o app rodando, já conectado no backend publicado. Crie uma
conta, mande uma mensagem, confirma que tá tudo funcionando antes de gerar o instalador.

## Passo 5 — Gerar o instalador

```bash
npm run dist
```

O instalador aparece em `desktop/release/`:
- **Windows:** um `.exe` (instalador NSIS).
- **macOS:** um `.dmg`.
- **Linux:** um `.AppImage`.

**Cada sistema operacional só consegue gerar de forma confiável o instalador do próprio
sistema** (rodar no Windows gera `.exe`, rodar no Mac gera `.dmg`, etc. — build cruzado
entre sistemas existe mas exige ferramentas extras tipo Wine e não é tão direto). Então,
na prática: gere o `.exe` numa máquina Windows, o `.dmg` num Mac, e mande pra cada amigo o
arquivo certo pro sistema dele.

## Passo 6 — Mandar pros amigos

Envie o arquivo gerado (`.exe`, `.dmg` ou `.AppImage`) por onde for mais fácil — Google
Drive, WeTransfer, Discord mesmo, etc. Eles instalam e abrem, sem precisar instalar Node,
sem terminal, sem nada.

**Aviso esperado:** como o instalador não tem "assinatura de código" (isso custa
dinheiro/burocracia — certificado de desenvolvedor), o Windows (SmartScreen) e o macOS
(Gatekeeper) provavelmente vão mostrar um aviso tipo "aplicativo de desenvolvedor
desconhecido". É só clicar em "Mais informações → Executar assim mesmo" (Windows) ou
segurar Ctrl e clicar em "Abrir" (Mac). Normal pra apps distribuídos assim, entre amigos.

## O que mudou no código pra isso funcionar

- `frontend/src/api.js` e `frontend/src/socket.js` já aceitavam `VITE_API_URL` /
  `VITE_SOCKET_URL` (feito quando preparamos o deploy web) — o app desktop só reaproveita
  isso.
- `backend/src/routes/uploads.js` agora devolve a URL da imagem **completa**
  (`https://seu-app.onrender.com/uploads/...`) em vez de relativa (`/uploads/...`). Isso
  era necessário: uma URL relativa só funciona dentro de um navegador comum, carregando a
  página do mesmo domínio do backend — o app desktop carrega a página de um arquivo local,
  então precisa da URL completa pra saber de onde buscar a imagem.
- O login trocou de `sessionStorage` pra `localStorage`, e foi adicionado um botão de
  logout (ícone ⏻ no rodapé da barra de servidores) — sem isso, todo mundo ficaria preso
  na primeira conta que usar pra sempre no app desktop.

## Atualizações futuras

Se você mudar o backend (código do `backend/`) e fizer redeploy no Render, o app desktop
continua funcionando sem precisar gerar de novo (ele só fala com a API por HTTP/WebSocket).
Só precisa gerar um novo instalador e reenviar pros amigos se você mudar o **frontend**
(`frontend/src`) ou o app desktop em si (`desktop/`).
