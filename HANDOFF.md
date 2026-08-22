# Handoff — Palácio Mental (discord-clone)

Trabalho em andamento: 3 features pedidas pelo usuário — (1) enviar GIFs via Tenor,
(2) perfil de usuário editável (avatar + banner + bio), (3) ícone de servidor editável.

## Backend — COMPLETO e funcional

- `backend/src/db.js`
  - Novas colunas: `users.avatar_url`, `users.banner_url`, `users.bio`, `servers.icon_url`.
  - Migração automática (`ALTER TABLE ... ADD COLUMN`) pra bancos já existentes — não precisa apagar `data.sqlite`.

- `backend/src/routes/auth.js`
  - `/register` e `/login` agora retornam `avatar_url`, `banner_url`, `bio` no objeto `user`.

- `backend/src/routes/users.js` (NOVO)
  - `GET /api/users/me` — perfil completo do usuário logado.
  - `PATCH /api/users/me` — body `{ avatar_url?, banner_url?, bio? }`, atualiza qualquer combinação desses campos. Bio limitada a 190 caracteres.
  - `GET /api/users/:userId` — perfil público de outro usuário. Só permite se o solicitante compartilha algum servidor com o alvo (403 caso contrário). Se `userId` for o próprio usuário, retorna igual ao `/me`.

- `backend/src/routes/servers.js`
  - `PATCH /api/servers/:serverId` — body `{ icon_url }`. Só o `owner` do servidor pode chamar (403 pra outros).
  - Queries de membros (`GET /:serverId/members`) e de mensagens de canal (`GET /channels/:channelId/messages`) agora selecionam `u.avatar_url` também (antes só `avatar_color`).

- `backend/src/routes/dms.js`
  - Queries de contatos e de mensagens de DM agora selecionam `u.avatar_url` também.

- `backend/src/routes/gifs.js` (NOVO)
  - `GET /api/gifs/search?q=...` — proxy pra Tenor API v2 (`tenor.googleapis.com/v2/search`), retorna `{ results: [{id, title, url, previewUrl, width, height}] }`.
  - `GET /api/gifs/featured` — gifs em alta (Tenor `/v2/featured`), usado como estado inicial do picker antes de digitar uma busca.
  - Usa `process.env.TENOR_API_KEY`, com fallback pra chave pública de demonstração do Tenor (`LIVDSRZULELA` — compartilhada, tem rate limit). **Antes de ir pra produção, pegar uma chave própria em https://tenor.com/gifapi e setar `TENOR_API_KEY` no ambiente.**
  - Usa `fetch` global do Node (precisa Node 18+; o projeto já usa `better-sqlite3` recente, então isso não deveria ser problema, mas vale checar `node -v`).

- `backend/src/server.js`
  - Rotas `userRoutes` e `gifRoutes` montadas em `/api/users` e `/api/gifs`.
  - Emissão de mensagens (`message:send`, `dm:send`) agora inclui `avatar_url` na row retornada via socket.
  - `voice:join` agora busca `avatar_color`/`avatar_url` **frescos do banco** (não do JWT, que pode estar desatualizado se o usuário editou o perfil depois de logar) e inclui isso nos objetos de presença (`voiceRooms`, `presenceList()`, evento `voice:user-joined`).

**Testar backend:** `cd backend && npm install && npm run dev` deve funcionar sem nenhuma mudança adicional — as migrações rodam sozinhas no boot.

## Frontend — PARCIAL

### Completo e devidamente ligado:

- `frontend/src/components/Avatar.jsx` (NOVO) — componente puro: recebe `{url, color, name, className, onClick, title}`; renderiza `<img>` se `url` existir, senão `<div>` com iniciais coloridas (comportamento original). Usado como substituto direto de todo `<div className="...avatar" style={{background: color}}>{iniciais}</div>` espalhado pelo código.

- `frontend/src/components/GifPicker.jsx` (NOVO) — funcional: campo de busca com debounce de 350ms, chama `api.searchGifs`/`api.getFeaturedGifs`, grade de resultados clicáveis, fecha ao clicar fora (mesmo padrão do `EmojiPicker.jsx`).

- `frontend/src/components/ProfileModal.jsx` (NOVO) — funcional, mas **ainda não é renderizado em lugar nenhum** (falta plugar no `App.jsx`, ver seção "Falta fazer"). Recebe `{token, userId, currentUser, onClose, onUpdated}`:
  - Se `userId === currentUser.id`: modo edição — botões pra trocar banner e avatar (upload via `api.uploadImage` já existente + `api.updateProfile` pra salvar a URL), textarea de bio com contador e botão salvar.
  - Se for outro usuário: modo somente leitura (banner, avatar, bio se houver). Vai dar 403 se não compartilharem servidor — isso já é tratado (mostra a mensagem de erro no modal).

- `frontend/src/api.js` — métodos novos adicionados: `getMe`, `getUserProfile`, `updateProfile`, `updateServer`, `searchGifs`, `getFeaturedGifs`. Todos seguindo o padrão existente do arquivo.

- `frontend/src/components/ChatArea.jsx`
  - Import de `GifPicker` e `Avatar`.
  - Novo estado `showGifs`, função `pickGif(gifUrl)` que emite `message:send`/`dm:send` com `attachmentUrl: gifUrl` e `content: ""` (reaproveita o mecanismo de anexo que já existe pra imagens — o backend/DB não precisou de nenhuma mudança pra isso, já que `attachment_url` aceita qualquer URL).
  - Novo botão "GIF" na barra de input, ao lado do de emoji, abrindo o `GifPicker`.
  - Avatar da mensagem trocado pro componente `<Avatar>`, com `onClick` chamando uma prop nova `onOpenProfile(authorId)` (opcional — só clicável se a prop for passada).
  - Prop nova `onOpenProfile` adicionada à assinatura do componente.

- `frontend/src/components/MemberList.jsx` — avatar trocado pro componente `<Avatar>`, clicável via prop nova `onOpenProfile(m.id)`.

- `frontend/src/components/DirectMessages.jsx` — avatar da lista de contatos trocado pro `<Avatar>`. Prop `onOpenProfile` recebida e repassada pro `<ChatArea>` interno.

- `frontend/src/components/VoiceChannel.jsx` — `participants` agora carrega `avatarColor`/`avatarUrl` (vindos dos eventos de socket já atualizados no backend). `renderTile()` mostra `<img>` quando há `avatarUrl`, senão cai pro comportamento antigo (cor + iniciais). Precisa da classe CSS `.voice-tile-avatar--img` (ver seção CSS).

- `frontend/src/components/ChannelSidebar.jsx` — presença de voz (lista de quem está no canal de voz, na sidebar) já mostra `<img>` quando `p.avatarUrl` existe. Precisa da classe CSS `.voice-presence-avatar--img`.

### Incompleto — `ChannelSidebar.jsx`

Esse arquivo está **funcional mas com a feature de ícone do servidor pela metade**:

- ✅ Já recebe as novas props: `token`, `isOwner`, `onOpenProfile`, `onUpdateServerIcon`.
- ✅ Já tem toda a lógica pronta: estado `uploadingIcon`/`iconError`, ref `iconInputRef`, função `handleIconFile(e)` que faz upload da imagem (`api.uploadImage`) e chama `onUpdateServerIcon(url)`.
- ❌ **Falta o JSX que usa tudo isso.** Hoje o `handleIconFile`, `iconInputRef`, `Avatar` (importado) e `isOwner` estão declarados mas não aparecem em lugar nenhum do `return (...)` — não há `<input type="file" ref={iconInputRef}>` nem botão que dispare `iconInputRef.current?.click()`, nem exibição de `iconError`.
- ❌ O cabeçalho do servidor (`.channel-col-header`, linha com `{server.name}`) ainda não mostra o `icon_url` nem tem um jeito de trocá-lo.
- ❌ O rodapé (`.channel-col-footer`, `me-avatar`) ainda usa o `<div>` de iniciais hardcoded em vez do componente `<Avatar>`, e não é clicável — precisa virar `<Avatar onClick={() => onOpenProfile?.(currentUser.id)}>`.

## O que falta fazer (passo a passo pra outra IA continuar)

1. **Terminar `ChannelSidebar.jsx`:**
   - No `.channel-col-header`, adicionar (só se `isOwner`) um pequeno botão/ícone de lápis ao lado do nome do servidor que chama `iconInputRef.current?.click()`. Mostrar o ícone atual do servidor (`server.icon_url`) como uma miniatura ali também, se existir.
   - Adicionar `<input type="file" accept="image/*" hidden ref={iconInputRef} onChange={handleIconFile} />` em algum lugar do JSX.
   - Trocar o `.me-avatar` do rodapé por `<Avatar className="me-avatar" url={currentUser.avatar_url} color={currentUser.avatar_color} name={currentUser.username} onClick={() => onOpenProfile?.(currentUser.id)} title="Ver/editar perfil" />`.
   - Mostrar `iconError` em algum lugar visível (mesmo padrão de `.chat-error` ou `.auth-error` já usado em outros componentes).

2. **`ServerSidebar.jsx`** — hoje cada ícone de servidor na barra da esquerda mostra as duas primeiras letras do nome (`s.name.slice(0,2)`). Precisa: se `s.icon_url` existir, renderizar uma `<img>` cobrindo o botão (`object-fit: cover`, mesmo border-radius do `.server-icon`) em vez das iniciais. É o mesmo padrão do `Avatar.jsx`, mas a forma visual é quadrado arredondado (16px), não círculo — dá pra reusar o componente `Avatar` passando a `className="server-icon"` já existente, já que o componente é agnóstico de forma (a forma vem do CSS da classe).

3. **`App.jsx`** — este é o arquivo central que falta atualizar:
   - Novo estado: `const [profileUserId, setProfileUserId] = useState(null);`
   - Função `openProfile(userId) { setProfileUserId(userId); }`
   - Passar `onOpenProfile={openProfile}` pra `ChatArea` (a instância direta em `App.jsx`, não só a de dentro de `DirectMessages`), `MemberList`, `DirectMessages`, e `ChannelSidebar`.
   - Passar `token={auth.token}` e `isOwner={isOwner}` pro `ChannelSidebar` (o `isOwner` já é calculado em `App.jsx`, só falta repassar).
   - Nova função:
     ```js
     async function updateServerIcon(iconUrl) {
       const updated = await api.updateServer(auth.token, activeServer.id, { icon_url: iconUrl });
       setActiveServer(updated);
       setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
     }
     ```
     e passar `onUpdateServerIcon={updateServerIcon}` pro `ChannelSidebar`.
   - Função pra quando o perfil é atualizado (avatar/banner/bio do PRÓPRIO usuário), pra refletir na hora em toda a UI sem precisar recarregar:
     ```js
     function handleProfileUpdated(updated) {
       if (updated.id !== currentUser.id) return; // só nos importa quando é o próprio usuário
       const nextUser = { ...auth.user, ...updated };
       const nextAuth = { ...auth, user: nextUser };
       sessionStorage.setItem("agora-auth", JSON.stringify(nextAuth));
       setAuth(nextAuth);
       setMembers((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
     }
     ```
     (Repare que `ProfileModal` já aceita e chama `onUpdated?.(updated)` — só falta ligar essa prop.)
   - Renderizar o modal condicionalmente, em qualquer lugar dentro do `<div className="app-shell">`:
     ```jsx
     {profileUserId && (
       <ProfileModal
         token={auth.token}
         userId={profileUserId}
         currentUser={currentUser}
         onClose={() => setProfileUserId(null)}
         onUpdated={handleProfileUpdated}
       />
     )}
     ```
   - Import: `import ProfileModal from "./components/ProfileModal.jsx";`

4. **CSS novo em `frontend/src/styles.css`** (nenhuma classe dessas existe ainda — sem elas o modal de perfil e o gif picker vão aparecer sem estilo nenhum):
   - `.profile-modal` — variação do `.modal` já existente, mas mais larga (~360-400px) e sem padding no topo (o banner precisa encostar nas bordas).
   - `.profile-banner` — altura fixa (~120px), `background-size: cover; background-position: center;`, cantos arredondados só em cima, `position: relative` (pra caber o botão de trocar e o avatar sobreposto).
   - `.profile-banner-edit` — botão pequeno no canto do banner (mesmo estilo do `.btn-icon`/`.btn-secondary`).
   - `.profile-avatar-wrap` — `position: absolute`, ancorado no canto inferior esquerdo do banner, saindo um pouco pra fora dele (efeito "avatar sobrepondo capa", clássico do Discord).
   - `.profile-avatar` — círculo grande (~72-80px), borda grossa na cor `--bg-panel` (pra destacar do banner atrás).
   - `.profile-avatar-edit` — botão pequeno tipo badge no canto do avatar.
   - `.profile-body` — padding normal (24px, como o `.modal` já tem).
   - `.profile-username` — `font-family: var(--font-display)`, tamanho maior, mesmo peso dos outros títulos.
   - `.profile-bio-label`, `.profile-bio-input` (textarea — reusar estilo de `input`/`select` já definido, com `resize: vertical`, `min-height` de ~70px), `.profile-bio-footer` (flex, `justify-content: space-between`, `align-items: center`), `.profile-bio-count` (`font-size: 11px`, `color: var(--text-muted)`), `.profile-bio-view` (parágrafo simples pro modo somente-leitura).
   - `.profile-loading` — centralizado, mesmo padrão visual de `.chat-empty`.
   - `.gif-picker` — mesmo padrão posicional do `.emoji-picker` já existente (`position: absolute; bottom: 48px; right: 0;`), mas mais largo (~320px) e mais alto (~280px, com `overflow-y: auto`).
   - `.gif-picker-search` — input normal, `width: 100%`, `margin-bottom: 8px`.
   - `.gif-picker-grid` — `display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;`.
   - `.gif-picker-item` — `overflow: hidden; border-radius: 8px;` com `img { width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1; }`.
   - `.gif-picker-status` — texto centralizado tipo `.chat-empty-inline`, `grid-column: 1 / -1` (ocupa a grade toda).
   - `.voice-tile-avatar--img` e `.voice-presence-avatar--img` — mesmas dimensões das classes base (`.voice-tile-avatar`, `.voice-presence-avatar`) já existentes, só adicionando `object-fit: cover;` (já que viram `<img>` em vez de `<div>` com texto).

5. **Testar fim a fim:**
   - `cd backend && npm install && npm run dev` (banco migra sozinho).
   - `cd frontend && npm install && npm run dev`.
   - Criar duas contas, entrar no mesmo servidor, testar: enviar gif, abrir perfil próprio e de outro membro, trocar avatar/banner/bio, trocar ícone do servidor sendo dono, entrar num canal de voz com as duas contas e confirmar que aparece a imagem de avatar (não só iniciais) na tela de quem está na call.

6. **`README.md`** — adicionar uma seção mencionando a variável de ambiente `TENOR_API_KEY` (como setar localmente, ex. `TENOR_API_KEY=sua_chave npm run dev` ou um arquivo `.env` com `dotenv`, que **não está instalado ainda** — se for usar `.env`, precisa adicionar `dotenv` ao `package.json` do backend e um `import "dotenv/config"` no topo do `server.js`) e um link pra `https://tenor.com/gifapi`.

## Coisas que a próxima IA deve saber

- Todo o app é em português (mensagens de erro, textos de UI, comentários de código) — manter esse padrão.
- O padrão visual dos modais existentes (`.modal-backdrop` + `.modal`) já está em `styles.css` linhas ~742-761 — o modal de perfil deve reaproveitar a base e só adicionar as classes específicas de banner/avatar.
- O CSS usa variáveis (`--bg-panel`, `--accent`, `--text-muted`, etc.) definidas em `:root` no topo do `styles.css` — usar essas variáveis, não cores hardcoded.
- Os botões (`.btn-primary`, `.btn-icon`, etc.) têm uma animação de "onda" via `::after` já aplicada globalmente por seletor (linhas ~786+ do CSS) — não precisa reimplementar isso, só usar as classes existentes.
- `api.uploadImage` (upload de arquivo genérico, existente antes desse trabalho) é reaproveitado tanto pra avatar/banner de perfil quanto pra ícone de servidor — não foi criado nenhum endpoint de upload novo, só reaproveitado o `/api/uploads` que já existia.
- Testes automatizados: o projeto não tem nenhum (nem antes desse trabalho) — não é esperado adicionar.
