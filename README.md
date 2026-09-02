Painel Sites Loft
Dashboard web do Loft Sites.
Rodar o projeto localmente
1. Pré-requisitos
Tenha instalado:
Node.js
Git
Confira se estão instalados:
```bash
node --version
npm --version
git --version
```
2. Baixar o projeto
Clone o repositório:
```bash
git clone <URL_DO_REPOSITORIO>
```
Entre na pasta do projeto:
```bash
cd painel-sites-loft
```
> Se você já baixou o projeto em `.zip`, basta extrair o arquivo e entrar na pasta `painel-sites-loft`.
3. Instalar as dependências
Na pasta do projeto, execute:
```bash
npm install
```
Isso instala as dependências definidas no `package.json`.
4. Iniciar o projeto
Execute:
```bash
npm run dev
```
O projeto será iniciado pelo Vercel CLI.
Abra no navegador o endereço exibido no terminal, normalmente:
```text
http://localhost:3000
```
5. Parar o projeto
No terminal, pressione:
```text
Ctrl + C
```
Comandos principais
Comando	Descrição
`npm install`	Instala as dependências
`npm run dev`	Inicia o projeto localmente
`npm run deploy`	Faz o deploy de produção pela Vercel
Estrutura do projeto
```text
painel-sites-loft/
├── api/
│   ├── bigquery.js
│   └── queries.js
├── public/
│   └── index.html
├── package.json
├── vercel.json
└── README.md
```
`public/`
Contém a interface do dashboard.
`api/`
Contém as funções da API utilizadas pelo dashboard.
`api/queries.js`
Contém as consultas disponíveis para o dashboard.
`api/bigquery.js`
Responsável por executar as consultas no BigQuery e retornar os resultados para o frontend.
`vercel.json`
Configura as funções serverless utilizadas pela Vercel.
Desenvolvimento
Sempre que fizer alterações no código:
Salve os arquivos.
Mantenha `npm run dev` executando.
Recarregue o navegador para visualizar as alterações.
Deploy
Para publicar a versão de produção:
```bash
npm run deploy
```
Ou, utilizando diretamente o Vercel CLI:
```bash
vercel --prod
```
Observações
As credenciais e variáveis de ambiente necessárias para acessar serviços externos não devem ser commitadas no Git.
Se o projeto exigir variáveis de ambiente localmente, configure-as em um arquivo `.env` conforme a configuração do ambiente de desenvolvimento.
Nunca publique chaves privadas, tokens ou credenciais no repositório.
