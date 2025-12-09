
📱 README – MusicAsk App (mobile)

# MusicAsk App 🎧📱

O **MusicAsk App** é o aplicativo mobile oficial do sistema MusicAsk, usado por DJs e organizadores para receber pedidos de música enviados pelo site configurado no evento.

O app é totalmente open-source e pode ser integrado com qualquer site compatível com as APIs do MusicAsk.

---

## 📌 Funcionalidades

- Conecta com o site informado nas configurações
- Recebe pedidos de música em tempo real
- Exibe avaliações enviadas pelo público
- Lista músicas pendentes
- Permite marcar músicas como “tocada”
- Atualiza dados automaticamente via APIs
- Funciona com qualquer site que siga o padrão MusicAsk

---

## ⚙ Como funciona

1. Instale o aplicativo.
2. Abra as configurações.
3. Insira o endereço do site do evento (exemplo: `https://meudj.com`).
4. O app automaticamente monta estas rotas:

/api/requests /api/request /api/ratings /api/rating

5. Os pedidos e avaliações começam a aparecer dentro do app.

Nenhum cadastro é necessário.

---

## 🔧 Padrão das APIs esperadas

O app faz requisições para:

### **Para pedidos**
- `GET /api/requests` → lista todos os pedidos
- `POST /api/request` → cria um novo pedido

### **Para avaliações**
- `GET /api/ratings` → lista todas as avaliações
- `POST /api/rating` → envia avaliação

---

## 📦 Estrutura do projeto

src/ components/ screens/ services/ config/

---

## 🧩 Compatibilidade

Qualquer site se torna compatível com o MusicAsk App apenas implementando as APIs descritas acima.

---

## 🤝 Contribuindo

1. Faça um fork do repositório  
2. Crie uma branch: `feature-nova-funcionalidade`  
3. Commit → push → Pull Request  

---

## 📄 Licença

Licença **MIT** — uso livre.

---

## 💡 Sobre

Criado para ser um sistema simples e aberto para DJs e eventos.  
O aplicativo é open-source porque o criador não utiliza mais o sistema, mas acredita que pode ser útil para outros
