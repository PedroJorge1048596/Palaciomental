# Palácio Mental — um Discord bem simples, feito para aprender

Projeto em duas partes:

- **backend/** — Node.js + Express + Socket.io + SQLite. Cuida de login, servidores, canais, mensagens e sinalização de voz.
- **frontend/** — React + Vite. A interface que você vai usar no navegador.

## Fase 1 (já pronta): chat de texto, servidores, canais e cargos
## Bônus: canal de voz básico com WebRTC (funciona bem para poucas pessoas ao mesmo tempo)

---

## Como rodar na sua máquina

Você vai precisar de **dois terminais abertos ao mesmo tempo** (um para o backend, outro para o frontend).

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

Se der tudo certo, vai aparecer algo como:

```
Backend rodando em http://localhost:4000
```

Deixe esse terminal aberto. Na primeira vez que rodar, ele cria sozinho o arquivo `backend/data.sqlite` com todas as tabelas.

### 2. Frontend

Em **outro terminal**:

```bash
cd frontend
npm install
npm run dev
```

Vai aparecer um link parecido com:

```
Local:   http://localhost:5173/
```

Abra esse endereço no navegador. Pronto — a interface deve carregar.

### 3. Testando com "múltiplos usuários"

Para simular duas pessoas conversando:
- Abra `http://localhost:5173` em uma aba normal e crie uma conta (ex: `maria`).
- Abra o mesmo endereço em uma **aba anônima** (ou outro navegador) e crie outra conta (ex: `joao`).
- Em uma das contas, crie um servidor — isso gera um **código de convite** (aparece no topo da lista de canais).
- Na outra conta, clique no botão `↵` na barra lateral esquerda e cole o código para entrar no mesmo servidor.
- Agora as duas abas podem trocar mensagens em tempo real, e testar o canal de voz (o navegador vai pedir permissão de microfone).

---

## O que já funciona

- Criar conta / login (senha criptografada, sessão via token)
- Criar servidores e convidar pessoas por código
- Canais de texto com mensagens em tempo real (Socket.io)
- Envio de imagens nas mensagens (📎), envio de GIFs via Giphy (🎞️) e seletor de emojis (🙂) — funciona em canais e em DMs
- Perfil de usuário com avatar, banner e bio (clique no seu avatar no rodapé da lista de canais, ou no avatar de outra pessoa numa mensagem/lista de membros)
- Ícone de servidor editável (o dono do servidor pode trocar clicando no lápis ao lado do nome, no topo da lista de canais)
- Mensagens diretas (DMs) — clique no ícone `@` na barra da esquerda; a lista de contatos mostra quem compartilha algum servidor com você
- Canais de voz com áudio via WebRTC (ponto a ponto — ótimo para testar, mas não escala para salas grandes)
- Compartilhamento de tela dentro do canal de voz (botão "Compartilhar tela")
- Cargos: dono, admin e membro — o dono pode promover/rebaixar membros, e admins podem criar canais

## Variável de ambiente opcional: GIPHY_API_KEY

A busca de GIFs usa a API pública do Giphy. Por padrão o backend usa uma chave de demonstração pública (`dc6zaTOxFJmzC`), que tem limite de requisições e pode ser bloqueada pelo Giphy (erro 403) por ser usada por muita gente ao mesmo tempo. Para uso mais sério, pegue sua própria chave gratuita em https://developers.giphy.com/dashboard/ e defina a variável de ambiente `GIPHY_API_KEY` antes de rodar o backend.

Jeito mais simples — arquivo `.env` (já vem pronto, com `dotenv` instalado):

```bash
cd backend
cp .env.example .env
# edite o .env e cole sua chave em GIPHY_API_KEY=
npm run dev
```

Ou passando direto na linha de comando, sem `.env`:

```bash
cd backend
GIPHY_API_KEY=sua_chave npm run dev
```

## Limitações conhecidas (para você evoluir como próximo passo)

- O canal de voz e o compartilhamento de tela usam uma conexão "mesh" (todo mundo conecta com todo mundo). Funciona bem até uns 4-5 participantes; para mais que isso, o ideal é usar um serviço de SFU (ex: LiveKit).
- Upload de imagem aceita só png/jpg/gif/webp, até 8MB, e fica salvo em `backend/uploads/` (não versionado no Git).
- O segredo do JWT está fixo no código (`backend/src/auth.js`) — tudo bem para estudo local, mas nunca faça isso em produção.

## Publicando online (pra mandar um link pros amigos)

Esse app precisa de um servidor rodando o tempo todo (não é um site estático) — o backend cuida do login, mensagens em tempo real e do banco de dados. O jeito mais simples é hospedar **backend e frontend juntos, num único serviço**, usando um host que tenha **disco persistente** (senão as contas e imagens somem a cada deploy/reinício).

### Recomendado: Render.com (tem plano gratuito)

1. **Suba o projeto pro GitHub** (crie um repositório novo e dê push nele — o Render puxa o deploy direto do Git).

2. **Crie um "Web Service"** no [Render](https://render.com), apontando pro seu repositório.

3. **Build Command:**
   ```bash
   cd frontend && npm install && VITE_SOCKET_URL=https://SEU-APP.onrender.com VITE_API_URL=https://SEU-APP.onrender.com npm run build && cd ../backend && npm install
   ```
   (troque `SEU-APP` pelo nome que você vai dar ao serviço no Render — dá pra ver/editar essa URL na tela de criação do serviço antes mesmo de fazer o primeiro deploy).

4. **Start Command:**
   ```bash
   cd backend && npm start
   ```

5. **Variáveis de ambiente** (aba "Environment" do Render):
   - `JWT_SECRET` — gere um valor aleatório (ex: `openssl rand -hex 32` no terminal, ou qualquer gerador de senha grande) e cole aqui. Sem isso o login fica inseguro.
   - `DATA_DIR` — aponte para `/var/data` (ou o caminho que você configurar no disco persistente do próximo passo).
   - `GIPHY_API_KEY` — opcional, ver seção acima.

6. **Disco persistente** (aba "Disks" do Render, dentro do serviço): adicione um disco e monte em `/var/data`. É isso que garante que `data.sqlite` (as contas) e as imagens enviadas não sumam quando o Render reiniciar ou fizer um novo deploy.

7. Depois do primeiro deploy, o Render te dá uma URL tipo `https://seu-app.onrender.com` — é esse link que você manda pros seus amigos.

**Atenção ao plano gratuito do Render:** o serviço "dorme" depois de alguns minutos sem uso, e demora ~30s-1min pra "acordar" na primeira requisição depois disso. Pra um grupo de amigos isso costuma ser tranquilo (só a primeira mensagem do dia demora um pouco), mas se incomodar, os planos pagos removem essa espera.

### Alternativas

- **Railway.app** — funciona de forma parecida (Git → deploy automático, volumes persistentes), mas não tem mais plano gratuito, só um período de teste.
- **Fly.io** — também tem disco persistente (`fly volumes`) e um free tier mais generoso em compute, porém a configuração é via linha de comando (`flyctl`), um pouco mais técnica que o Render.
- Hospedar frontend e backend **separados** (ex: frontend na Vercel/Netlify, backend no Render) também funciona — o código já está preparado pra isso (`VITE_API_URL` e `VITE_SOCKET_URL`) — mas dá mais trabalho de configuração sem ganhar muito, já que o Render sozinho serve os dois juntos.

### Segurança básica antes de divulgar o link

- Defina `JWT_SECRET` (passo 5 acima) — sem isso qualquer pessoa consegue forjar um login.
- Lembre que hoje **qualquer pessoa com o link consegue criar uma conta** (não tem convite/aprovação pra se cadastrar no app em si, só pra entrar em servidores). Para um grupo fechado de amigos, isso normalmente não é um problema, mas vale ter em mente.
- Upload de imagem já tem limite de 8MB e só aceita png/jpg/gif/webp — ok para uso entre amigos.

## App desktop (opcional)

Se preferir um app de verdade (janela própria, ícone, sem abrir navegador) em vez de mandar um link, veja o `DESKTOP.md` — ele empacota esse mesmo frontend com Electron, conectando no backend publicado acima.
