<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Un appareil Android en direct au cœur d'une conversation <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — émulateur ou téléphone USB, piloté entièrement via adb.</strong><br />
  <sub>20 outils d'agent &bull; flux en direct produit dans le processus, sans assistant externe &bull; panneau de navigation à trois boutons &bull; compilation &amp; exécution Gradle &bull; OCR Vision</sub>
</p>

<p align="center">
  <sub>npm : <code>@zseven-w/dsh-android</code> &middot; Version actuelle du plugin : <code>0.1.0-rc.2</code> &middot; Testé avec DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <b>Français</b> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — a live Android device inside the conversation" width="100%" />
</p>
<p align="center"><sub>Un appareil Android diffusé et piloté depuis une conversation DSH — l'appel d'outil de l'agent au centre, le panneau de l'appareil en direct à droite</sub></p>

## Pourquoi DSH Android

DSH Android donne à l'agent un véritable appareil Android au cœur de la conversation — et vous donne les pixels. L'agent peut démarrer un flux sur un émulateur ou sur un téléphone connecté en USB, compiler et installer un projet Gradle, piloter l'interface par `resource-id`/texte ou par OCR, lire logcat et inspecter processus et mémoire, pendant qu'un flux en direct de l'appareil s'affiche dans un panneau latéral persistant où vous pouvez toucher, faire glisser, pivoter et appuyer sur Retour / Accueil / Récents directement sur la vidéo. Aucun bloc d'image, aucun fichier d'enregistrement d'écran : les octets visuels n'atteignent l'interface que par des URL signées et à durée de vie courte servies par le serveur web de DSH.

Il n'existe qu'un seul chemin de code. `adb devices -l` rapporte un **serial**, et ce serial est la seule identité d'un appareil — `emulator-5554`, un serial USB ou une cible `ip:port` se comportent tous de la même manière. Le plugin n'est lié à aucun produit d'émulation (AVD, Genymotion, WSA, une ferme d'appareils cloud), et il n'y a aucune scission simulateur/appareil réel à garder en tête.

| | |
| --- | --- |
| 📱 **Un appareil en direct dans la conversation** | Un flux PNG `multipart/x-mixed-replace` produit **dans le processus** et servi directement depuis le tampon de la dernière image, via des routes signées `/_dsh/dsh-android/*`. |
| 🔌 **Aucun assistant de flux externe, aucun port interne** | Un unique processus enfant `adb exec-out` persistant exécute `while :; do screencap -p; done` ; l'hôte découpe lui-même les PNG concaténés en images. Aucun serveur de flux en boucle locale à relayer, aucune plage de ports à gérer, et rien à adopter après un arrêt brutal. |
| 🧩 **Un seul chemin de code adb** | Pour adb comme pour ce plugin, émulateurs et téléphones sont la même chose. Pas de double pile `simctl`/WebDriverAgent, pas de cérémonie de compilation et de confiance avant qu'un appareil physique ne fonctionne. |
| 🛠️ **20 outils d'agent** | Appareils, démarrage/extinction, capture d'écran, interaction, compilation &amp; exécution Gradle, liste/lancement d'applications, arbre d'interface `uiautomator` + appui par élément, actions sur les lignes de listes/flux, recherche/appui/attente par OCR Vision, logcat, processus, backtrace ANR/plantage, meminfo, informations sur une application. |
| 👆 **Panneau de navigation à trois boutons** | Touchez et faites glisser sur la vidéo en direct ; une barre d'outils avec **◁ Retour · ○ Accueil · □ Récents**, plus rotation, capture d'écran et rafraîchissement ; un menu d'appareil pour le volet de notifications, les réglages rapides, le verrouillage, le réveil et l'assistant. |
| 🖼️ **Multimodal natif** | Sur un modèle capable de traiter les images, chaque outil de capture (screenshot, interact, tap_element, tap_text, tap_row) renvoie la capture d'écran ELLE-MÊME sous forme d'image block — le modèle voit l'écran directement. L'OCR reste pour les appuis sur du texte au pixel près et pour les routes purement textuelles ; les modèles texte seul conservent le résumé JSON brut. |
| 🔐 **Routes signées, en boucle locale uniquement** | Chaque route exige un pair en boucle locale, un `Host` en boucle locale (rebinding DNS rejeté) et des vérifications Fetch-Metadata/Origin — **avant** que la moindre capacité ne soit consultée. Les capacités HMAC-SHA256 expirent sous 10 minutes. |
| 🔍 **Automatisation sémantique + visuelle** | `android_ui_tree` exporte la hiérarchie `uiautomator` et `android_tap_element` appuie par `resource-id`, texte ou content-description ; quand l'arbre est vide ou que le texte est incrusté dans une image, `android_find_text` / `android_tap_text` passent l'écran à l'OCR au lieu de deviner des coordonnées. |

## Outils

Les 20 outils sont enregistrés sur tous les hôtes et renvoient du JSON brut — les octets visuels n'atteignent l'interface que par `presentationMeta` + routes signées, jamais sous forme de blocs d'image. Quand adb ne peut pas être résolu, les outils restent enregistrés et chaque appel échoue avec une erreur explicative qui nomme la solution.

Les coordonnées sont partout **normalisées 0..1 sur l'image diffusée**. L'image suit la rotation de l'écran (une application en paysage diffuse en 2400×1080 sur un appareil 1080×2400) et `input tap` partage ce même espace : aucun calcul de rotation côté client n'existe donc nulle part dans ce plugin.

### Outils principaux

| Outil | Description | Paramètres clés |
| --- | --- | --- |
| `android_devices` | Liste chaque appareil rapporté par `adb devices -l` (serial, état, émulateur/physique, modèle, version d'Android, niveau d'API, nom d'AVD) ainsi que les noms d'AVD de la machine sous `avds`. Sert à découvrir le serial que prennent les autres outils. Une énumération en échec lève une erreur au lieu de renvoyer une liste vide. | — |
| `android_boot` | Démarre le flux en direct. Passez un serial ONLINE pour le diffuser immédiatement, ou un nom d'AVD pour lancer d'abord cet émulateur et le diffuser une fois son démarrage terminé (plusieurs minutes à froid). Le flux reste vivant pour toute la conversation, afin que le panneau puisse montrer l'appareil en direct. | `device` (requis — un serial ou un nom d'AVD) |
| `android_shutdown` | Éteint un émulateur (`adb emu kill`) et arrête le flux quand il vise cet appareil. Un appareil physique est refusé avec la raison : adb ne sait pas couper l'alimentation d'un téléphone. | `device` |
| `android_screenshot` | Capture un PNG et renvoie un petit résumé JSON (chemin, octets, dimensions, appareil) ; l'image s'affiche dans la carte et dans le panneau, jamais comme bloc d'image. | `device` (facultatif — l'appareil diffusé, sinon le seul en ligne) |
| `android_interact` | Interagit avec l'appareil diffusé : appui à des coordonnées normalisées 0..1, saisie de texte, appui sur un bouton de navigation ou matériel (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), envoi d'un geste de balayage ou défilement. Une fois l'action stabilisée (~300 ms), une nouvelle capture montre l'effet. | `action` (requis — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Liste les paquets installés sur l'appareil (`pm list packages`), avec le nom de version issu de `dumpsys package` et un libellé lisible quand il est résolvable — un nom de paquet tiers ne se devine pas, alors listez-le ou passez `name` à `android_launch_app`. | `device`, `query` (sous-chaîne insensible à la casse, CJK inclus), `include_system` (false par défaut) |
| `android_launch_app` | Lance une application installée par `packageName`, ou par `name` (une sous-chaîne de libellé insensible à la casse, résolue via la même liste). Exactement l'un des deux. `relaunch` force d'abord l'arrêt de l'application. | `packageName` ou `name` (exactement un), `device`, `relaunch` |
| `android_build_run` | Compile un projet Gradle (`./gradlew assembleDebug`), installe l'APK debug produit (`adb install -r`) et le lance. Une compilation complète prend plusieurs minutes ; en cas d'échec, le résultat porte la fin de la sortie d'erreur de Gradle. | `projectPath` (requis), `device` |

### Outils d'arbre d'interface et de lignes (`uiautomator`)

| Outil | Description | Paramètres clés |
| --- | --- | --- |
| `android_ui_tree` | Exporte la hiérarchie `uiautomator` de l'application au premier plan sous forme de nœuds — `type` (la fin du nom de classe), `text`, `contentDesc`, `resourceId`, `bounds` en pixels, `enabled`, `focused` — plafonnée à ~40 Ko (les niveaux les plus profonds sont élagués et `truncated` est positionné). | `device`, `max_depth`, `filter` (sous-chaîne insensible à la casse sur text/content-description/resource-id) |
| `android_tap_element` | Appuie sur un élément par son identité — `resource_id` correspond au `resource-id` du nœud ; `text` correspond à son texte ou à sa content-description. Correspondance exacte d'abord, puis sous-chaîne insensible à la casse ; les doublons imbriqués sont réduits à une seule cible et une correspondance ambiguë liste jusqu'à 8 candidats au lieu d'en choisir un. Les éléments désactivés sont refusés. L'appui tombe au centre de l'élément, puis une capture après ~300 ms montre l'effet ; passez `expect_text` / `expect_gone` et l'appui plus sa vérification ne font qu'un aller-retour. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Lit un écran de liste/flux (`RecyclerView` et consorts) comme des LIGNES plutôt que comme un arbre brut : les enfants répétés de même forme deviennent des lignes portant un index, un cadre en pixels, le libellé agrégé et les compteurs extraits de ce libellé (nombre + classificateur, en chinois ou en anglais — aucun vocabulaire applicatif n'est codé en dur). Les clés de compteur font l'aller-retour : passez-en une exactement telle qu'elle est listée à `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Appuie à une position relative à l'intérieur d'une ligne visible (`index` issu de `android_ui_rows` ; `x`/`y` en fractions du cadre de cette ligne, 0,5 = centre par défaut). Le cadre provient d'une lecture d'arbre FRAÎCHE, donc aucune coordonnée absolue n'est devinée, et un index hors plage ÉCHOUE au lieu d'être borné. Avec `expect_count={key, delta}`, l'outil relit la ligne après ~800 ms et vérifie que le compteur a bougé d'exactement ±1 ; une clé inconnue REFUSE l'appui avant qu'il n'ait lieu. | `device`, `index` (requis), `x`, `y`, `expect_count` (`{key, delta}`) |

### Outils OCR, journaux et débogage

| Outil | Description | Paramètres clés |
| --- | --- | --- |
| `android_find_text` | Passe l'écran COURANT à l'OCR avec l'assistant Vision compilé par le plugin (reconnaissance accurate, zh-Hans + en-US). À utiliser quand l'arbre d'interface est vide ou dégénéré, pour du texte rendu comme un graphique (compteurs de badge, prix incrustés dans des images), ou pour vérifier indépendamment ce qui est à l'écran. Renvoie `{device, size, items:[{text, confidence, rect}]}` où les rects sont des boîtes en **pixels** d'origine en haut à gauche, triées par confiance et plafonnées à ~40 Ko. Hôte macOS uniquement. | `device`, `query` (sous-chaîne insensible à la casse), `min_confidence` (0.3 par défaut) |
| `android_tap_text` | Passe l'écran COURANT à l'OCR et appuie au centre de la meilleure correspondance textuelle — exactement les mêmes règles que `android_tap_element` (exact → contient → liste de candidats), pour du texte que l'arbre d'interface ne voit pas. Le centre en pixels de la correspondance est normalisé sur la taille de l'image et envoyé comme appui ; après ~300 ms, une nouvelle capture montre l'effet. Hôte macOS uniquement. | `device`, `query` (requis), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Attend qu'un texte apparaisse ou disparaisse, en interrogeant le même pipeline capture + OCR toutes les 600 ms jusqu'à ce que la condition soit remplie ou que le délai expire (8 s par défaut, 60 s au maximum). Un dépassement de délai est une réponse `matched:false` normale, jamais une erreur. Hôte macOS uniquement. | `device`, `text` (requis), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Lit ce que journalise l'appareil : `snapshot` (`logcat -d -v time` sur une fenêtre récente, 2m par défaut) ou `follow` (une capture en direct bornée par `duration_seconds`, 10 par défaut, 60 au maximum — jamais un flux qui reste suspendu). Filtrez sur une seule application avec `bundle_id` (le nom de paquet Android, résolu vers son pid). La sortie est plafonnée à ~300 lignes / 30 Ko avec une suggestion pour affiner. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Liste les processus en cours d'exécution sur l'appareil (`ps -A`) sous forme `{pid, name}` — la source des pid pour `android_backtrace`. | `device`, `filter` (sous-chaîne insensible à la casse sur le nom du processus) |
| `android_backtrace` | Demande au processus de vider ses piles (`kill -3`) et lit la trace ANR obtenue dans `/data/anr/`. La plupart des appareils non rootés refusent ce répertoire : l'outil se replie alors sur le tampon de plantage (`logcat -b crash -d`) et indique honnêtement quel moteur a répondu et ce qu'il ne peut pas voir. | `device`, `pid` ou `bundle_id` |
| `android_meminfo` | Analyse `dumpsys meminfo <package>` : PSS total, la répartition Java/native/graphics et les principales catégories — la réponse Android à un résumé de fuites. | `device`, `bundle_id` (requis) |
| `android_app_info` | Les faits d'une application installée d'après `dumpsys package <package>` : nom et code de version, répertoire de données, chemin du code, date de première installation et indicateur système. Une application absente renvoie `installed: false` plus une note nommant `android_list_apps` — sans lever d'erreur. | `device`, `bundle_id` (requis) |

## Surfaces d'affichage

- **Panneau latéral.** La vue en direct vit dans un panneau persistant à droite (un dock fixe qui écarte la conversation, ou une superposition centrée sur les viewports étroits). Il affiche le flux PNG en direct et accepte le clic-pour-toucher et le glisser-pour-geste directement sur la vidéo, avec une barre d'outils portant **◁ Retour**, **○ Accueil**, **□ Récents**, la rotation, la capture d'écran et le rafraîchissement. Un menu d'appareil exécute les cinq actions de niveau appareil (volet de notifications, réglages rapides, verrouillage, réveil, assistant). Le sélecteur d'appareils liste tous les appareils adb dans UNE seule liste, groupés par type, les AVD hors ligne apparaissant comme une indication renvoyant vers `android_boot` plutôt que comme un démarrage au clic. Les modes de taille et les styles de cadre (sans cadre / fine bordure / coque de téléphone) fonctionnent comme dans le jumeau iOS ; le panneau adapte son rapport d'aspect à la taille naturelle de l'image, si bien qu'une rotation ne demande aucune configuration.
- **Cartes de conversation compactes.** Les résultats d'outils s'affichent sous forme de cartes d'une ligne sans image intégrée : le nom de l'appareil, un sous-libellé d'action, un badge d'état et une invite « ouvrir dans le panneau latéral ». Cliquer sur la ligne ouvre le panneau.
- **Capsule d'état au-dessus de la saisie.** Quand le panneau est fermé et qu'un flux est en ligne, une petite pastille apparaît au-dessus de la zone de saisie et ouvre le panneau quand on clique dessus.
- **Mode standard et mode Code.** Les sessions standard utilisent le `presentationMeta` projeté par l'hôte ; les envois imbriqués du mode Code ne transportent pas de meta, donc le client reconstruit le meta identique à partir du JSON de résultat durable — le panneau, les cartes et la capsule fonctionnent dans les deux cas.

## Sécurité

- **Le navigateur ne parle jamais à adb, et il n'existe aucun port interne à qui parler.** Le flux est produit dans ce processus et servi depuis la mémoire ; chaque octet traverse l'origine du serveur web de DSH par des routes `/_dsh/dsh-android/*` appartenant au plugin : `/stream/<token>` (PNG multipart en direct), `/screenshot/<token>` (PNG mis en cache), plus `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` et `/device-action`. La surface d'attaque est strictement plus petite que celle d'un serveur de flux en boucle locale relayé.
- **Une triple barrière de boucle locale, appliquée avant toute lecture de capacité.** Le pair de transport doit être une adresse en boucle locale, l'en-tête `Host` doit nommer une autorité en boucle locale (un `Host` de rebinding DNS est donc rejeté) et Fetch-Metadata/`Origin` doivent être de même origine. Host et Origin sont des données contrôlées par l'appelant : elles ne sont jamais crues seules.
- **Des capacités HMAC-SHA256 expirant sous 10 minutes**, au format `base64url(payload).base64url(mac)` et signées avec une clé de 32 octets propre à chaque répertoire personnel DSH (`<DSH_HOME>/cache/dsh-android/stream-access.key`, mode 0600, créée atomiquement). Une capacité émise pour un appareil cesse de fonctionner dès qu'un autre appareil prend l'emplacement de flux, et une capacité de capture d'écran ne peut pas être rejouée sur la route de flux.
- **La route de capture d'écran ne sert qu'un seul répertoire.** Les chemins sont parcourus avec `lstat` (tout lien symbolique est refusé), conclus par une vérification de confinement `realpath`, ouverts avec `O_NOFOLLOW`, bornés en taille et revalidés après la lecture — ainsi un fichier remplacé par un lien symbolique entre l'émission et la récupération n'est jamais servi.
- **`/grant` ne démarre jamais rien.** Il lance seulement la boucle d'images pour un appareil déjà en ligne, et refuse (409 `device_busy`) d'arracher le flux à un autre appareil. Changer d'appareil exige le geste explicite `/switch-device` ; démarrer un AVD reste l'affaire de l'outil `android_boot`.
- **Keep-alive et arrêt en cas d'inactivité.** Une boucle d'images qui plante redémarre en arrière-plan (~5 s de délai) ; sans aucun consommateur, le flux s'arrête de lui-même après 5 minutes. Les arrêts intentionnels ne sont jamais contrariés.

## Prérequis

- **Node ≥ 24.11.0.**
- **adb**, issu des platform-tools du SDK Android, résolu dans cet ordre : la variable d'environnement `ADB` → `adb` sur le `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/la racine SDK par défaut du système + `/platform-tools/adb`. Installez-le avec `sdkmanager "platform-tools"`, avec Android Studio ou avec `brew install --cask android-platform-tools`. Sans adb, le plugin se charge quand même et les 20 outils s'enregistrent ; chaque appel explique alors ce qui manque.
- **Un appareil** : un émulateur, quel que soit le produit, ou un téléphone avec le débogage USB activé. Le lanceur `emulator` est facultatif et seul `android_boot` par nom d'AVD en a besoin — tout le reste fonctionne avec ce qu'adb voit.
- **DSH ≥ 0.1.0-rc.6 avec le bundle web** pour le panneau. Les profils sans interface fonctionnent aussi : les 20 outils marchent normalement, simplement sans la vue en direct.
- **Un hôte macOS pour l'OCR** (seuls `android_find_text` / `android_tap_text` / `android_wait_for` en ont besoin) : à la première utilisation, le plugin compile son `assets/ocr.swift` embarqué avec `swiftc` vers `~/Library/Caches/dsh-android/bin/ocr`. Sur les hôtes Linux et Windows, ces trois outils signalent que l'OCR requiert le framework Vision de macOS ; les 17 autres ne sont pas affectés. Surcharges : `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (facultatif, pour la saisie CJK et emoji) : `adb shell input text` ne gère que l'ASCII. Installez [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) sur l'appareil et sélectionnez-le comme méthode de saisie active : le texte non ASCII est alors délivré par son interface de broadcast. Sans lui, la saisie non ASCII est REFUSÉE avec l'indication d'installation — jamais silencieusement déformée.

## Appareils physiques

Il n'y a aucun équivalent de WebDriverAgent à compiler, signer, faire approuver puis re-signer tous les sept jours. Activez le débogage USB, branchez le téléphone, acceptez l'invite d'autorisation sur l'appareil, et il apparaît dans `android_devices` avec tous les outils opérationnels. Un appareil non autorisé est signalé comme tel, avec l'indication sur l'invite, et non comme un échec mystérieux.

Trois réserves honnêtes :

- **La fréquence d'images est plus faible en USB** — environ 2–5 fps sur un téléphone contre 5–10 fps sur un émulateur, parce que chaque image traverse le lien USB sous forme de PNG complet.
- **La saisie CJK nécessite ADBKeyboard** (voir ci-dessus) ; cela vaut autant pour les émulateurs que pour les téléphones.
- **`android_shutdown` ne peut pas éteindre un téléphone.** adb n'a pas ce verbe ; l'outil le dit au lieu de faire semblant.

## Performances

Mesuré sur un émulateur (Android 14, 1080×2400) :

| | |
| --- | --- |
| Boucle screencap persistante | ≈ 8 fps |
| Première image de `ensureStreaming` | ~200 ms |
| Aller-retour d'un `input tap` | ~130 ms |

C'est l'unique processus enfant persistant qui rend cela possible : lancer un `adb` par image coûte ~50–100 ms avant que le moindre pixel ne bouge. Comptez ~5–10 fps sur un émulateur et ~2–5 fps sur un téléphone USB, selon la machine et la densité d'écran.

## Installation dans DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Ou ajoutez-le comme dépendance d'un paquet de profil existant :

```sh
pnpm add @zseven-w/dsh-android
```

## Démarrage rapide

1. **Découvrir les appareils** — « Liste les appareils Android. » → `android_devices`.
2. **Démarrer le flux** — « Diffuse emulator-5554. » → `android_boot`. Le panneau s'ouvre avec l'appareil en direct. (Un nom d'AVD démarre d'abord cet émulateur.)
3. **Toucher sur la vidéo** — touchez ou faites glisser directement sur le panneau, ou laissez l'agent piloter : « Ouvre les Réglages, puis touche Affichage. » → `android_interact`, ou `android_ui_tree` + `android_tap_element` pour des appuis par identité, ou `android_find_text` + `android_tap_text` quand l'arbre est aveugle.
4. **Compiler et lancer votre application** — « Compile et lance /path/to/MyApp. » → `android_build_run`. Une compilation Gradle complète prend plusieurs minutes ; une fois terminée, l'application démarre et vous la regardez vivre dans le panneau.
5. **Lire les journaux** — « Montre les deux dernières minutes de logcat pour com.example.app. » → `android_logs`.

## Dépannage

- **Tous les outils disent qu'adb est indisponible** — l'erreur nomme les trois niveaux de résolution. Définissez `ADB=/chemin/vers/adb`, mettez `adb` sur le `PATH`, ou installez les platform-tools du SDK (`sdkmanager "platform-tools"`).
- **L'appareil est `unauthorized`** — acceptez l'invite de débogage USB sur l'écran de l'appareil. `android_devices` rapporte honnêtement l'état plutôt que de masquer l'appareil.
- **`android_boot` ne trouve pas d'AVD** — le lanceur `emulator` n'a pas été trouvé. Démarrez l'émulateur par n'importe quel moyen ; il apparaît dans `android_devices` dès qu'adb le voit, et `android_boot` prend alors son serial.
- **Le texte non ASCII est refusé** — installez ADBKeyboard et sélectionnez-le comme méthode de saisie (voir Prérequis). Ce refus est délibéré : `input text` supprimerait ou déformerait silencieusement les caractères.
- **`android_find_text` dit que l'OCR est indisponible** — l'OCR nécessite un hôte macOS (le framework Vision d'Apple). Les 17 outils sans OCR fonctionnent partout.
- **Le flux s'arrête tout seul** — c'est la politique d'inactivité, pas un plantage : sans consommateur (panneau fermé, aucune carte montée, aucune route active), le flux s'arrête après 5 minutes et redémarre au prochain appel d'outil ou à l'ouverture du panneau. Une boucle qui plante redémarre d'elle-même en ~5 secondes.
- **La rotation semble incorrecte sur l'écran d'accueil** — les lanceurs et les Réglages se figent en portrait et ignorent `user_rotation`. C'est le comportement normal d'Android, pas un bug du plugin ; faites pivoter dans une application qui l'autorise.

## Développement

```sh
pnpm install
pnpm run build      # tsc de l'hôte + bundle client → lib/
pnpm run typecheck
pnpm test           # toutes les suites statiques ; aucun appareil requis
```

Les suites de smoke tests de `scripts/` exercent le `lib/` compilé. Toutes sont statiques sauf `dev-emulator-smoke.mjs`, qui nécessite un appareil et rapporte SKIP (code de sortie 0) quand il n'y en a pas.

| Script | Ce qu'il couvre |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | La résolution d'adb (env / PATH / SDK) face à un binaire factice, l'analyse de `devices -l`, un `exec-out` sûr pour le binaire, le découpeur d'images PNG et sa resynchronisation, l'échappement d'input text, et le cycle de vie de l'hôte (flux, contrôle, arrêt en inactivité, dispose) face à une chaîne d'outils simulée. |
| `node scripts/dev-routes-static-smoke.mjs` | Les routes signées face à un hôte factice : grants relatifs, jetons expirés/forgés/de mauvais type, la barrière de boucle locale, les enveloppes 405/415/400, les refus d'appareil codés, la validation de `/control`, la forme de rotate, le confinement des captures d'écran et le flux multipart en direct. |
| `node scripts/dev-tools-smoke.mjs` | Les outils principaux face à un hôte factice via la couture `createAndroidTools`. |
| `node scripts/dev-uitree-smoke.mjs` | Les outils d'arbre et de lignes : analyse XML `uiautomator`, sélecteurs, plafonnement de profondeur, heuristiques de lignes et de compteurs. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` snapshot/follow, filtres, plafonds et récupération des processus. |
| `node scripts/dev-panel-smoke.mjs` | Composants du panneau, modes de taille, styles de cadre, logique dock/déclencheur/capsule (SSR uniquement). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Appareil réel : première image, fréquence d'images soutenue, aller-retour d'un appui, dispose. |

## Autres problèmes connus
### Flux blanc / vide sur un émulateur

Si le panneau diffuse une image entièrement blanche (ou noire) alors que
`android_ui_tree` voit encore de vrais éléments d'interface, la relecture du
framebuffer par le GPU hôte de l'émulateur est cassée sur votre machine (un
problème gfxstream connu sur certains hôtes macOS — `screencap` lui-même renvoie
des images vides, donc tous les outils d'écran sont touchés). Relancez
l'émulateur en rendu logiciel :

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

ou définissez `hw.gpu.mode=swiftshader_indirect` dans le `config.ini` de l'AVD.
Les appareils physiques ne sont jamais concernés.

## Feuille de route

- **Une source à fréquence d'images plus élevée.** La couture `StreamSource` est délibérément interchangeable : un chemin `scrcpy-server` + WebCodecs H.264 remplacerait le flux PNG image par image sans toucher aux routes, aux outils ni au panneau.
- **Rechargement à chaud des aperçus Compose.** Le jumeau iOS échange à chaud les aperçus SwiftUI sous forme de dylib ; Compose n'a aujourd'hui aucune primitive d'échange à chaud équivalente, alors cela reste un projet futur plutôt qu'une fonctionnalité livrée et instable.

## Écosystème

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — la même architecture pour le simulateur iOS et les iPhone connectés en USB
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — déléguer des tâches aux agents DSH depuis Claude Code / Codex
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — mémoire à long terme pour DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — inspecter et modifier des documents `.op` dans une conversation

## Crédits & Licence

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — résolus à l'exécution, jamais redistribués : la licence du SDK de Google n'en permet pas l'inclusion.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — l'IME optionnel sur l'appareil derrière la saisie non ASCII (Apache-2.0 ; non embarqué).
- Architecture et posture de sécurité des routes partagées avec [dsh-ios](https://github.com/ZSeven-W/dsh-ios), dont ce plugin est le portage.
- Voir [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) pour l'intégralité des mentions.

**Licence** : MIT
