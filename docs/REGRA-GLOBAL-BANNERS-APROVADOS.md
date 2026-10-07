# Regra global de banners WireGeek / Bagaça Studios

## Referência vinculante
O **último modelo explicitamente aprovado pelo usuário** é o único modelo visual autorizado. A referência é o banner vertical de hardware com iluminação roxa/laranja, categoria GEEK no topo esquerdo, título principal branco OPENAI, tema laranja AGENTES PROFISSIONAIS, bloco editorial branco curto e assinatura BAGAÇA STUDIOS entre linhas laranja. Imagens posteriores geradas como propostas não substituem essa aprovação.

## Elementos imutáveis
O renderer deve reproduzir o modelo aprovado, sem reinterpretar composição, tipografia, hierarquia, dimensões 1080 × 1350 (4:5), cores, margens, posicionamento, enquadramento, degradês, linhas, bloco editorial ou assinatura. Não alterar escala da tipografia, reorganizar elementos ou aplicar efeitos extras sem aprovação explícita.

## Conteúdo variável permitido
Apenas a categoria, os títulos, a imagem real/oficial correspondente à notícia e o texto editorial previsto nas áreas do modelo podem variar. Se não houver imagem oficial adequada, buscar a logomarca oficial da notícia, franquia ou projeto. **Não usar IA generativa para criar, refazer ou substituir a imagem principal.** Confirmar a procedência da imagem antes de renderizar; um URL por si só não prova que a imagem é oficial.

## Copy editorial
Cada notícia nova deve conter exatamente 2 highlights, com **8 a 14 palavras cada**. O banner deve funcionar como chamada curta para leitura da matéria completa no site. Preserve matérias e banners antigos persistidos; não modificar artefatos ou MP4s já aprovados/imutáveis. Corrigir tracking de OPENAI sem inserir espaço artificial ou mudar a marca oficial.

## Títulos visuais e validação em pixels
Os campos `title_main` e `title_theme` são exclusivos da composição do banner: `titulo` e `titulo_curto` canônicos não podem ser alterados. Ambas as linhas devem ser medidas usando exatamente as fontes, os tamanhos, o espaçamento e o processamento do renderer aprovado. Limite individual: **950 px**. Antes de buscar imagens ou persistir banners, validar a largura real de ambas as linhas. Quando `TITLE_MAIN_TOO_LONG` ou `TITLE_THEME_TOO_LONG` ocorrer, permitir **no máximo uma segunda proposta de divisão textual**, sem regras especiais por franquia, sem diminuir fontes ou substituir grafias oficiais. Se continuar fora da largura, interromper com erro específico; não usar automaticamente um título legado como solução de encaixe. Adicionar testes de medida real, tentativas limitadas e preservação do título canônico.

## Restrições de execução
Na ausência de imagem apropriada, referência visual verificável ou dados exigidos, **não improvisar**; suspender a geração e comunicar o impedimento. Nenhuma mudança visual estrutural é permitida sem autorização expressa. Qualquer mudança no renderer exige revisão das invariantes e testes; o teste automatizado não substitui comparação visual com a referência aprovada.

## Escopo de publicação
Alterações desta regra devem ser validadas em Preview antes de qualquer produção. Sem autorização explícita: não fazer merge, deploy de produção, mutação de banco, preparação de Reel ou publicação em rede social.
