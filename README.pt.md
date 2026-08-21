<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Um dispositivo Android ao vivo dentro de uma conversa do <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — emulador ou celular USB, tudo conduzido via adb.</strong><br />
  <sub>20 ferramentas de agente &bull; fluxo ao vivo gerado no próprio processo, sem helper externo &bull; painel de navegação de três botões &bull; build &amp; execução com Gradle &bull; OCR do Vision</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Versão atual do plugin: <code>0.1.0-rc.3</code> &middot; Testado com o DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <b>Português</b> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — a live Android device inside the conversation" width="100%" />
</p>
<p align="center"><sub>Um dispositivo Android transmitido e controlado de dentro de uma conversa do DSH — a chamada de ferramenta do agente no centro, o painel do dispositivo ao vivo à direita</sub></p>

## Por que o DSH Android

O DSH Android entrega ao agente um dispositivo Android de verdade dentro da conversa — e entrega os pixels a você. O agente pode iniciar um fluxo em um emulador ou em um celular conectado por USB, compilar e instalar um projeto Gradle, conduzir a interface por `resource-id`/texto ou por OCR, ler o logcat e inspecionar processos e memória, enquanto o fluxo ao vivo do dispositivo é renderizado em um painel lateral persistente onde você pode tocar, arrastar, girar e apertar Voltar / Início / Recentes diretamente no vídeo. Nada de blocos de imagem nem de arquivos de gravação de tela: os bytes visuais só chegam à interface por URLs assinadas e de curta validade servidas pelo webserver do DSH.

Existe exatamente um caminho de código. O `adb devices -l` reporta um **serial**, e esse serial é a única identidade de um dispositivo — `emulator-5554`, um serial USB ou um alvo `ip:port` se comportam de forma idêntica. O plugin não está preso a nenhum produto de emulação (AVD, Genymotion, WSA, uma fazenda de dispositivos na nuvem), e não há divisão simulador/dispositivo real com que se preocupar.

| | |
| --- | --- |
| 📱 **Dispositivo ao vivo na conversa** | Um fluxo PNG `multipart/x-mixed-replace` produzido **no próprio processo** e servido direto do buffer do último frame por rotas assinadas `/_dsh/dsh-android/*`. |
| 🔌 **Sem helper de fluxo externo, sem porta interna** | Um único processo filho `adb exec-out` persistente executa `while :; do screencap -p; done`; o host mesmo divide os PNGs concatenados em frames. Não há servidor de fluxo em loopback para fazer proxy, nem faixa de portas para gerenciar, nem nada para adotar depois de uma saída abrupta. |
| 🧩 **Um só caminho de código adb** | Para o adb, e para este plugin, emuladores e celulares são a mesma coisa. Sem pilha dupla `simctl`/WebDriverAgent, sem a dança de compilar e confiar antes que um dispositivo físico funcione. |
| 🛠️ **20 ferramentas de agente** | Dispositivos, inicialização/desligamento, captura de tela, interação, build &amp; execução com Gradle, listagem/lançamento de apps, árvore de UI do `uiautomator` + toque por elemento, ações em linhas de listas/feeds, buscar/tocar/aguardar com OCR do Vision, logcat, processos, backtrace de ANR/crash, meminfo, informações do app. |
| 👆 **Painel de navegação de três botões** | Toque e arraste no vídeo ao vivo; uma barra com **◁ Voltar · ○ Início · □ Recentes**, além de girar, capturar e atualizar; um menu de dispositivo para a área de notificações, as configurações rápidas, bloquear, acordar e o assistente. |
| 🖼️ **Multimodal nativo** | Em um modelo capaz de lidar com imagens, toda ferramenta de captura (screenshot, interact, tap_element, tap_text, tap_row) devolve a própria captura de tela como um image block — o modelo vê a tela diretamente. O OCR permanece para toques em texto com precisão de pixel e para rotas somente texto; modelos somente texto continuam recebendo o resumo JSON simples. |
| 🔐 **Rotas assinadas, somente em loopback** | Toda rota exige um par em loopback, um `Host` de loopback (DNS rebinding é rejeitado) e verificações de Fetch-Metadata/Origin — **antes** de qualquer capability ser consultada. As capabilities HMAC-SHA256 expiram em até 10 minutos. |
| 🔍 **Automação semântica + visual** | O `android_ui_tree` despeja a hierarquia do `uiautomator` e o `android_tap_element` toca por `resource-id`, texto ou content-description; quando a árvore está vazia ou o texto está embutido em uma imagem, `android_find_text` / `android_tap_text` fazem OCR da tela em vez de adivinhar coordenadas. |

## Ferramentas

As 20 ferramentas são registradas em todo host e retornam JSON puro — os bytes visuais só chegam à interface por `presentationMeta` + rotas assinadas, nunca como blocos de imagem. Quando o adb não pode ser resolvido, as ferramentas continuam registradas e toda chamada falha com um erro explicativo que nomeia a correção.

As coordenadas são sempre **normalizadas em 0..1 do frame transmitido**. O frame acompanha a rotação do display (um app em paisagem transmite 2400×1080 num dispositivo 1080×2400) e o `input tap` compartilha esse mesmo espaço, então não existe nenhuma conta de rotação no cliente em lugar algum deste plugin.

### Ferramentas principais

| Ferramenta | O que ela faz | Parâmetros principais |
| --- | --- | --- |
| `android_devices` | Lista todo dispositivo reportado por `adb devices -l` (serial, estado, emulador/físico, modelo, versão do Android, nível de API, nome do AVD) mais os nomes de AVD da máquina em `avds`. Use-a para descobrir o serial que as demais ferramentas recebem. Uma enumeração que falha lança erro em vez de devolver uma lista vazia. | — |
| `android_boot` | Inicia o fluxo ao vivo. Passe um serial ONLINE para transmiti-lo imediatamente, ou um nome de AVD para iniciar aquele emulador primeiro e transmiti-lo assim que terminar de inicializar (minutos em partida a frio). O fluxo permanece vivo durante toda a conversa, para que o painel possa mostrar o dispositivo ao vivo. | `device` (obrigatório — um serial ou um nome de AVD) |
| `android_shutdown` | Desliga um emulador (`adb emu kill`) e para o fluxo quando ele aponta para esse dispositivo. Um dispositivo físico é recusado com o motivo: o adb não consegue desligar um celular. | `device` |
| `android_screenshot` | Captura um PNG e retorna um pequeno resumo em JSON (caminho, bytes, dimensões, dispositivo); a imagem é renderizada no card e no painel, nunca como bloco de imagem. | `device` (opcional — o dispositivo em transmissão, senão o único online) |
| `android_interact` | Interage com o dispositivo em transmissão: toque em coordenadas normalizadas 0..1, digitação de texto, pressionar um botão de navegação ou de hardware (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), enviar um gesto de deslize ou rolar. Depois que a ação assenta (~300 ms), uma captura nova mostra o efeito. | `action` (obrigatório — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Lista os pacotes instalados no dispositivo (`pm list packages`), com o nome de versão vindo do `dumpsys package` e um rótulo legível quando ele é resolvível — o nome de um pacote de terceiros não se adivinha, então liste-o ou passe `name` para `android_launch_app`. | `device`, `query` (substring sem diferenciar maiúsculas, CJK incluído), `include_system` (padrão false) |
| `android_launch_app` | Inicia um app instalado por `packageName`, ou por `name` (uma substring de rótulo sem diferenciar maiúsculas, resolvida pela mesma listagem). Exatamente um dos dois. `relaunch` força a parada do app antes. | `packageName` ou `name` (exatamente um), `device`, `relaunch` |
| `android_build_run` | Compila um projeto Gradle (`./gradlew assembleDebug`), instala o APK de debug resultante (`adb install -r`) e o inicia. Um build completo leva minutos; em caso de falha, o resultado carrega o final da saída de erro do Gradle. | `projectPath` (obrigatório), `device` |

### Ferramentas de árvore de UI e de linhas (`uiautomator`)

| Ferramenta | O que ela faz | Parâmetros principais |
| --- | --- | --- |
| `android_ui_tree` | Despeja a hierarquia `uiautomator` do app em primeiro plano como nós — `type` (o final do nome da classe), `text`, `contentDesc`, `resourceId`, `bounds` em pixels, `enabled`, `focused` — limitada a ~40 KB (os níveis mais profundos são podados e `truncated` é marcado). | `device`, `max_depth`, `filter` (substring sem diferenciar maiúsculas sobre text/content-description/resource-id) |
| `android_tap_element` | Toca em um elemento pela identidade — `resource_id` casa com o `resource-id` do nó; `text` casa com seu texto ou content-description. Primeiro correspondência exata, depois substring sem diferenciar maiúsculas; duplicatas aninhadas se fundem em um único alvo e uma correspondência ambígua lista até 8 candidatos em vez de escolher um. Elementos desabilitados são recusados. O toque cai no centro do elemento e, ~300 ms depois, uma captura mostra o efeito; passe `expect_text` / `expect_gone` e o toque mais a verificação viram uma única ida e volta. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Lê uma tela de lista/feed (`RecyclerView` e afins) como LINHAS em vez de árvore crua: filhos repetidos de mesmo formato viram linhas com um índice, um frame em pixels, o rótulo agregado e os contadores extraídos desse rótulo (número + classificador, em chinês ou inglês — nenhum vocabulário de app é fixado no código). As chaves de contador fazem a ida e volta: passe uma exatamente como listada para `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Toca em uma posição relativa dentro de uma linha visível (`index` vindo de `android_ui_rows`; `x`/`y` como frações do frame daquela linha, padrão 0,5 = centro). O frame vem de uma leitura NOVA da árvore, então nenhuma coordenada absoluta é adivinhada, e um índice fora do intervalo FALHA em vez de ser limitado. Com `expect_count={key, delta}` a ferramenta relê a linha após ~800 ms e verifica se o contador moveu exatamente ±1; uma chave desconhecida RECUSA o toque antes que ele aconteça. | `device`, `index` (obrigatório), `x`, `y`, `expect_count` (`{key, delta}`) |

### Ferramentas de OCR, logs e depuração

| Ferramenta | O que ela faz | Parâmetros principais |
| --- | --- | --- |
| `android_find_text` | Faz OCR da tela ATUAL com o helper do Vision compilado pelo plugin (reconhecimento accurate, zh-Hans + en-US). Use quando a árvore de UI estiver vazia ou degenerada, para texto renderizado como gráfico (contadores de badge, preços embutidos em imagens), ou para verificar de forma independente o que está na tela. Retorna `{device, size, items:[{text, confidence, rect}]}`, em que os rects são caixas em **pixels** com origem no canto superior esquerdo, ordenadas por confiança e limitadas a ~40 KB. Apenas em host macOS. | `device`, `query` (substring sem diferenciar maiúsculas), `min_confidence` (padrão 0.3) |
| `android_tap_text` | Faz OCR da tela ATUAL e toca no centro da melhor correspondência de texto — exatamente as mesmas regras do `android_tap_element` (exato → contém → lista de candidatos), para texto que a árvore de UI não enxerga. O centro em pixels da correspondência é normalizado pelo tamanho do frame e enviado como toque; após ~300 ms uma captura nova mostra o efeito. Apenas em host macOS. | `device`, `query` (obrigatório), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Aguarda até um texto aparecer ou desaparecer, consultando o mesmo pipeline de captura + OCR a cada 600 ms até a condição valer ou o tempo esgotar (padrão 8 s, máximo 60 s). Um tempo esgotado é uma resposta `matched:false` normal, nunca um erro. Apenas em host macOS. | `device`, `text` (obrigatório), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Lê o que o dispositivo registra: `snapshot` (`logcat -d -v time` sobre uma janela recente, padrão 2m) ou `follow` (uma captura ao vivo limitada por `duration_seconds`, padrão 10, máximo 60 — nunca um fluxo pendurado). Filtre para um app com `bundle_id` (o nome do pacote Android, resolvido para seu pid). A saída é limitada a ~300 linhas / 30 KB, com uma dica para restringir. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Lista os processos em execução no dispositivo (`ps -A`) como `{pid, name}` — a fonte de pid para o `android_backtrace`. | `device`, `filter` (substring sem diferenciar maiúsculas sobre o nome do processo) |
| `android_backtrace` | Pede ao processo que despeje suas pilhas (`kill -3`) e lê o trace de ANR resultante em `/data/anr/`. A maioria dos dispositivos sem root recusa esse diretório, então a ferramenta degrada para o buffer de crash (`logcat -b crash -d`) e relata honestamente qual motor respondeu e o que ele não consegue ver. | `device`, `pid` ou `bundle_id` |
| `android_meminfo` | Analisa `dumpsys meminfo <package>`: PSS total, a divisão Java/nativo/gráficos e as principais categorias — a resposta do Android a um resumo de vazamentos. | `device`, `bundle_id` (obrigatório) |
| `android_app_info` | Fatos de um app instalado a partir de `dumpsys package <package>`: nome e código de versão, diretório de dados, caminho do código, data da primeira instalação e a flag de sistema. Um app ausente retorna `installed: false` mais uma nota citando `android_list_apps` — não lança erro. | `device`, `bundle_id` (obrigatório) |

## Superfícies de exibição

- **Painel lateral.** A visão ao vivo fica em um painel persistente do lado direito (um dock fixo que empurra a conversa para o lado, ou um overlay centralizado em viewports estreitas). Ele renderiza o fluxo PNG ao vivo e aceita clique-para-tocar e arrasto-para-gesto diretamente no vídeo, com uma barra trazendo **◁ Voltar**, **○ Início**, **□ Recentes**, girar, capturar e atualizar. Um menu de dispositivo executa as cinco ações de nível de dispositivo (área de notificações, configurações rápidas, bloquear, acordar, assistente). O seletor de dispositivos lista todos os dispositivos adb em UMA lista, agrupados por tipo, com os AVDs offline mostrados como uma dica apontando para `android_boot` em vez de iniciarem ao clique. Os modos de tamanho e os estilos de moldura (sem moldura / bezel / casca de celular) funcionam como no gêmeo iOS; o painel deriva sua proporção do tamanho natural do próprio frame, de modo que uma rotação não exige configuração alguma.
- **Cards compactos na conversa.** Resultados de ferramentas são renderizados como cards de uma linha, sem imagens inline: o nome do dispositivo, um sub-rótulo de ação, um badge de status e uma dica de "abrir na barra lateral". Clicar na linha abre o painel.
- **Cápsula de status acima do campo de mensagem.** Enquanto o painel está fechado e um fluxo está online, uma pequena pílula aparece acima do campo de mensagem e abre o painel quando clicada.
- **Modo padrão e Modo de Código.** Sessões padrão usam o `presentationMeta` projetado pelo host; despachos aninhados do Modo de Código não carregam meta, então o cliente reconstrói o meta idêntico a partir do JSON de resultado durável — o painel, os cards e a cápsula funcionam nos dois casos.

## Segurança

- **O navegador nunca fala com o adb, e não existe porta interna com quem falar.** O fluxo é produzido neste processo e servido da memória; cada byte atravessa a origem do webserver do DSH por rotas `/_dsh/dsh-android/*` do plugin: `/stream/<token>` (PNG multipart ao vivo), `/screenshot/<token>` (PNG em cache), mais `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` e `/device-action`. É uma superfície de ataque estritamente menor que a de um servidor de fluxo em loopback com proxy.
- **Uma tripla proteção de loopback, aplicada antes de qualquer capability ser lida.** O par de transporte precisa ser um endereço de loopback, o cabeçalho `Host` precisa nomear uma autoridade de loopback (portanto um `Host` de DNS rebinding é rejeitado) e Fetch-Metadata/`Origin` precisam ser da mesma origem. Host e Origin são dados controlados por quem chama e nunca são acreditados sozinhos.
- **Capabilities HMAC-SHA256 que expiram em até 10 minutos**, no formato `base64url(payload).base64url(mac)` e assinadas com uma chave de 32 bytes por home do DSH (`<DSH_HOME>/cache/dsh-android/stream-access.key`, modo 0600, criada atomicamente). Uma capability emitida para um dispositivo para de funcionar no instante em que outro dispositivo assume o slot do fluxo, e uma capability de captura de tela não pode ser reproduzida contra a rota de fluxo.
- **A rota de captura de tela serve exatamente um diretório.** Os caminhos são percorridos com `lstat` (qualquer link simbólico é recusado), fechados com uma checagem de contenção por `realpath`, abertos com `O_NOFOLLOW`, limitados em tamanho e revalidados após a leitura — assim, um arquivo trocado por um link simbólico entre a emissão e a busca nunca é servido.
- **O `/grant` nunca inicializa nada.** Ele apenas começa o laço de frames para um dispositivo que já está online, e recusa (409 `device_busy`) arrancar o fluxo de outro dispositivo. Trocar de dispositivo exige o gesto explícito `/switch-device`; iniciar um AVD continua sendo tarefa da ferramenta `android_boot`.
- **Keep-alive e parada ociosa.** Um laço de frames que travou reinicia em segundo plano (atraso de ~5 s); com zero consumidores, o fluxo para sozinho após 5 minutos. Paradas intencionais nunca são combatidas.

## Requisitos

- **Node ≥ 24.11.0.**
- **adb**, das platform-tools do SDK do Android, resolvido nesta ordem: a variável de ambiente `ADB` → `adb` no `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/a raiz padrão do SDK de cada sistema + `/platform-tools/adb`. Instale com `sdkmanager "platform-tools"`, com o Android Studio ou com `brew install --cask android-platform-tools`. Sem o adb o plugin ainda carrega e as 20 ferramentas se registram; cada chamada então explica o que está faltando.
- **Um dispositivo**: um emulador de qualquer produto, ou um celular com a depuração USB ativada. O lançador `emulator` é opcional e só o `android_boot` por nome de AVD precisa dele — todo o resto funciona com o que o adb conseguir ver.
- **DSH ≥ 0.1.0-rc.6 com o bundle web** para o painel. Perfis headless também funcionam: as 20 ferramentas operam normalmente, apenas sem a visão ao vivo.
- **Host macOS para OCR** (só `android_find_text` / `android_tap_text` / `android_wait_for` precisam): no primeiro uso, o plugin compila o `assets/ocr.swift` que acompanha o pacote com `swiftc` em `~/Library/Caches/dsh-android/bin/ocr`. Em hosts Linux e Windows essas três ferramentas informam que o OCR precisa do framework Vision do macOS; as outras 17 não são afetadas. Sobrescritas: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (opcional, para digitação CJK e emoji): o `adb shell input text` só aceita ASCII. Instale o [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) no dispositivo e selecione-o como IME ativo, e o texto não ASCII será entregue pela interface de broadcast dele. Sem ele, digitar caracteres não ASCII é RECUSADO com a dica de instalação — nunca digitado errado em silêncio.

## Dispositivos físicos

Não há equivalente ao WebDriverAgent para compilar, assinar, confiar e reassinar a cada sete dias. Ative a depuração USB, conecte o celular, aceite o aviso de autorização no dispositivo, e ele aparece em `android_devices` com todas as ferramentas funcionando contra ele. Um dispositivo não autorizado é reportado como tal, com a dica sobre o aviso, e não como uma falha misteriosa.

Três ressalvas honestas:

- **A taxa de quadros é menor por USB** — cerca de 2–5 fps num celular contra 5–10 fps num emulador, porque cada quadro atravessa o link USB como um PNG completo.
- **Digitar CJK exige o ADBKeyboard** (veja acima); isso vale igualmente para emuladores e celulares.
- **O `android_shutdown` não desliga um celular.** O adb não tem esse verbo; a ferramenta diz isso em vez de fingir.

## Desempenho

Medido num emulador (Android 14, 1080×2400):

| | |
| --- | --- |
| Laço screencap persistente | ≈ 8 fps |
| Primeiro frame do `ensureStreaming` | ~200 ms |
| Ida e volta de um `input tap` | ~130 ms |

Quem compra esses números é o único processo filho persistente: iniciar um `adb` por quadro custa ~50–100 ms antes que qualquer pixel se mova. Espere ~5–10 fps num emulador e ~2–5 fps num celular USB, dependendo da máquina e da densidade da tela.

## Instalar no DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Ou adicione-o como dependência de um pacote de perfil existente:

```sh
pnpm add @zseven-w/dsh-android
```

## Início rápido

1. **Descobrir dispositivos** — "Liste os dispositivos Android." → `android_devices`.
2. **Iniciar o fluxo** — "Transmita o emulator-5554." → `android_boot`. O painel abre com o dispositivo ao vivo. (Um nome de AVD inicia aquele emulador primeiro.)
3. **Tocar no vídeo** — toque ou arraste diretamente no painel, ou deixe o agente conduzir: "Abra as Configurações e toque em Tela." → `android_interact`, ou `android_ui_tree` + `android_tap_element` para toques por identidade, ou `android_find_text` + `android_tap_text` quando a árvore está cega.
4. **Compilar e rodar seu app** — "Compile e rode /path/to/MyApp." → `android_build_run`. Um build completo do Gradle leva minutos; quando ele conclui, o app é iniciado e você o acompanha ao vivo no painel.
5. **Ler os logs** — "Mostre os últimos dois minutos de logcat de com.example.app." → `android_logs`.

## Solução de problemas

- **Todas as ferramentas dizem que o adb está indisponível** — o erro nomeia os três níveis de resolução. Defina `ADB=/caminho/para/adb`, coloque o `adb` no `PATH`, ou instale as platform-tools do SDK (`sdkmanager "platform-tools"`).
- **O dispositivo está `unauthorized`** — aceite o aviso de depuração USB na tela do dispositivo. O `android_devices` reporta o estado com honestidade em vez de esconder o dispositivo.
- **O `android_boot` não encontra um AVD** — o lançador `emulator` não foi localizado. Inicie o emulador por qualquer meio; ele aparece em `android_devices` assim que o adb o enxerga, e o `android_boot` então assume o serial dele.
- **Texto não ASCII é recusado** — instale o ADBKeyboard e selecione-o como método de entrada (veja Requisitos). A recusa é deliberada: o `input text` descartaria ou embaralharia os caracteres em silêncio.
- **O `android_find_text` diz que o OCR está indisponível** — o OCR precisa de um host macOS (o framework Vision da Apple). As 17 ferramentas sem OCR funcionam em qualquer lugar.
- **O fluxo para sozinho** — isso é a política de ociosidade, não uma queda: com zero consumidores (painel fechado, nenhum card montado, nenhuma rota ativa) o fluxo para após 5 minutos e reinicia na próxima chamada de ferramenta ou ao abrir o painel. Um laço que travou reinicia sozinho em ~5 segundos.
- **A rotação parece errada na tela inicial** — launchers e as Configurações se fixam em retrato e ignoram `user_rotation`. Esse é o comportamento normal do Android, não um bug do plugin; gire dentro de um app que permita.

## Desenvolvimento

```sh
pnpm install
pnpm run build      # tsc do host + bundle do cliente → lib/
pnpm run typecheck
pnpm test           # todas as suítes estáticas; nenhum dispositivo necessário
```

As suítes de smoke em `scripts/` exercitam o `lib/` compilado. Todas são estáticas, exceto `dev-emulator-smoke.mjs`, que precisa de um dispositivo e reporta SKIP (saída 0) quando não há nenhum.

| Script | O que cobre |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | A resolução do adb (env / PATH / SDK) contra um binário simulado, o parsing de `devices -l`, um `exec-out` seguro para binários, o divisor de frames PNG e sua ressincronização, o escape de input text, e o ciclo de vida do host (fluxo, controle, parada ociosa, dispose) contra uma toolchain falsa. |
| `node scripts/dev-routes-static-smoke.mjs` | As rotas assinadas contra um host falso: grants relativos, tokens expirados/forjados/de tipo errado, a proteção de loopback, os envelopes 405/415/400, as recusas de dispositivo codificadas, a validação de `/control`, o formato do rotate, a contenção da captura de tela e o fluxo multipart ao vivo. |
| `node scripts/dev-tools-smoke.mjs` | As ferramentas principais contra um host falso pela costura `createAndroidTools`. |
| `node scripts/dev-uitree-smoke.mjs` | Ferramentas de árvore de UI e de linhas: parsing do XML do `uiautomator`, seletores, limite de profundidade, heurísticas de linhas e contadores. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` snapshot/follow, filtros, limites e recolhimento de processos. |
| `node scripts/dev-panel-smoke.mjs` | Componentes do painel, modos de tamanho, estilos de moldura, lógica de dock/gatilho/cápsula (apenas SSR). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Dispositivo real: primeiro frame, taxa de quadros sustentada, ida e volta de um toque, dispose. |

## Outros problemas conhecidos
### Fluxo branco / preto num emulador

Se o painel transmite uma imagem totalmente branca (ou preta) enquanto o
`android_ui_tree` ainda enxerga elementos de UI reais, a leitura do framebuffer
pela GPU do host do emulador está quebrada na sua máquina (um problema conhecido
do gfxstream em alguns hosts macOS — o próprio `screencap` devolve frames em
branco, então todas as ferramentas de tela são afetadas). Reinicie o emulador com
renderização por software:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

ou defina `hw.gpu.mode=swiftshader_indirect` no `config.ini` do AVD. Dispositivos
físicos nunca são afetados.

## Roadmap

- **Uma fonte com taxa de quadros mais alta.** A costura `StreamSource` é deliberadamente plugável: um caminho `scrcpy-server` + WebCodecs H.264 substituiria o fluxo PNG quadro a quadro sem tocar nas rotas, nas ferramentas ou no painel.
- **Hot reload de previews do Compose.** O gêmeo iOS troca a quente os previews do SwiftUI como dylib; o Compose não tem hoje uma primitiva de hot swap equivalente, então isso fica como item futuro em vez de algo entregue e instável.

## Ecossistema

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — a mesma arquitetura para o Simulador de iOS e iPhones conectados por USB
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — delegar trabalho a agentes DSH a partir do Claude Code / Codex
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — memória de longo prazo para o DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — inspecionar e editar documentos `.op` dentro de uma conversa

## Créditos &amp; Licença

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — resolvidas em tempo de execução, nunca redistribuídas: a licença do SDK do Google não permite embuti-las.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — o IME opcional no dispositivo por trás da digitação não ASCII (Apache-2.0; não embutido).
- Arquitetura e postura de segurança das rotas compartilhadas com o [dsh-ios](https://github.com/ZSeven-W/dsh-ios), de onde este plugin foi portado.
- Veja [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) para os avisos completos.

**Licença**: MIT
