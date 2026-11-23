/**
 * ぶるりぱ名言集カルタ - メインアプリケーション
 */
(function (global) {
  const STORAGE_KEY_DECKS = 'bururipa_karuta_decks_v1';

  // data/cards.json 読み込み失敗時のフォールバック用初期データ
  const FALLBACK_DECKS = [
  {
    "id": "bururipa_quotes",
    "title": "ぶるりぱ名言集",
    "description": "ぶるりぱの名言を集めたカルタデッキ。「札の管理」または data/cards.json から札を追加できます。",
    "cards": []
  }
];

  const KEY_BINDINGS = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM'.split('');

  const audio = new global.KarutaAudio();
  const network = new global.KarutaNetwork({
    onMessage: handleNetworkMessage,
    onPeerDisconnected: handlePeerDisconnected,
    onDisconnectedFromHost: handleHostDisconnected,
    onError: (err) => showToast(`通信エラー: ${err.message || err.type || '接続失敗'}`, true)
  });

  const state = {
    decks: [],
    myId: 'self',
    myName: 'プレイヤー1',
    mode: 'cpu', // 'online_host' | 'online_guest' | 'cpu'
    cpuLevel: 'normal',
    roomCode: '',
    players: [], // { id, name, isHost, isCpu, ready, score, takes, misses, reactionTimes: [], lockedUntil: 0 }
    settings: {
      deckId: 'bururipa_quotes',
      rounds: '10',
      fieldCount: '12',
      displayMode: 'text_and_voice',
      otetsuki: 'lock',
      speechRate: '1.0'
    },
    game: {
      active: false,
      fieldCards: [],
      takenIds: new Set(),
      deckQueue: [],
      roundIndex: 0,
      totalRounds: 10,
      currentCard: null,
      roundOpen: false,
      roundStartTime: 0,
      showKeyHints: false,
      timerInterval: null,
      cpuTimeout: null,
      nextRoundTimeout: null
    },
    editorDeckId: null,
    editingCardId: null,
    previousView: 'view-lobby'
  };

  // DOM 要素取得ヘルパー
  const $ = (id) => document.getElementById(id);

  function showView(viewId) {
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    const target = $(viewId);
    if (target) target.classList.add('active');
  }

  function showToast(msg, isError = false) {
    const container = $('toast-container');
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3400);
  }

  // デッキデータの読み込み（localStorage -> data/cards.json -> fallback）
  async function loadDecks() {
    let loaded = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_DECKS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) loaded = parsed;
      }
    } catch (_) {}

    if (!loaded) {
      try {
        const res = await fetch('data/cards.json', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.decks) && json.decks.length > 0) {
            loaded = json.decks;
          }
        }
      } catch (_) {}
    }

    state.decks = loaded || JSON.parse(JSON.stringify(FALLBACK_DECKS));
    if (!state.decks.some((d) => d.id === state.settings.deckId)) {
      state.settings.deckId = state.decks[0].id;
    }
    state.editorDeckId = state.decks[0].id;
    populateDeckSelects();
  }

  function saveDecksToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY_DECKS, JSON.stringify(state.decks));
    } catch (_) {}
  }

  function populateDeckSelects() {
    const settingSel = $('setting-deck');
    const editorSel = $('editor-select-deck');
    [settingSel, editorSel].forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = '';
      state.decks.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.title} (${d.cards.length}首)`;
        sel.appendChild(opt);
      });
    });
    if (settingSel) settingSel.value = state.settings.deckId;
    if (editorSel && state.editorDeckId) editorSel.value = state.editorDeckId;
  }

  function getSelectedDeck() {
    return state.decks.find((d) => d.id === state.settings.deckId) || state.decks[0];
  }

  // 待機室の描画
  function renderWaitingRoom() {
    const isOnline = state.mode !== 'cpu';
    const isHost = state.mode === 'online_host' || state.mode === 'cpu';

    $('waiting-mode-badge').textContent =
      state.mode === 'cpu' ? 'ソロ / CPU対戦' : isHost ? 'オンライン（ホスト）' : 'オンライン（ゲスト）';
    $('waiting-room-title').textContent = state.mode === 'cpu' ? '対戦準備' : 'オンライン待機室';

    const codeBox = $('room-code-box');
    if (isOnline) {
      codeBox.classList.remove('hidden');
      $('display-room-code').textContent = state.roomCode;
    } else {
      codeBox.classList.add('hidden');
    }

    $('player-count').textContent = String(state.players.length);
    const list = $('player-list');
    list.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'player-item';
      const left = document.createElement('div');
      left.className = 'player-name-wrap';
      left.textContent = p.name;
      if (p.isHost) {
        const b = document.createElement('span');
        b.className = 'badge-host';
        b.textContent = 'HOST';
        left.appendChild(b);
      }
      if (p.isCpu) {
        const b = document.createElement('span');
        b.className = 'badge-host';
        b.textContent = 'CPU';
        left.appendChild(b);
      }
      const right = document.createElement('span');
      right.className = p.ready ? 'badge-ready' : 'badge-not-ready';
      right.textContent = p.ready ? '準備完了' : '待機中';
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });

    // 設定フォームのロック制御（ゲストは閲覧のみ）
    const settingIds = [
      'setting-deck',
      'setting-rounds',
      'setting-field-count',
      'setting-display-mode',
      'setting-otetsuki',
      'setting-speech-rate'
    ];
    settingIds.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !isHost;
    });
    $('setting-deck').value = state.settings.deckId;
    $('setting-rounds').value = state.settings.rounds;
    $('setting-field-count').value = state.settings.fieldCount;
    $('setting-display-mode').value = state.settings.displayMode;
    $('setting-otetsuki').value = state.settings.otetsuki;
    $('setting-speech-rate').value = state.settings.speechRate;
    $('settings-lock-note').textContent = isHost ? '' : '（ホストが設定中）';
    const selectedDeck = getSelectedDeck();
    const emptyWarn = $('empty-deck-warning');
    if (emptyWarn) {
      emptyWarn.classList.toggle('hidden', Boolean(selectedDeck && selectedDeck.cards.length > 0));
    }

    const btnReady = $('btn-toggle-ready');
    const btnStart = $('btn-start-game');
    if (state.mode === 'cpu') {
      btnReady.classList.add('hidden');
      btnStart.classList.remove('hidden');
      btnStart.disabled = false;
    } else if (isHost) {
      btnReady.classList.add('hidden');
      btnStart.classList.remove('hidden');
      const allReady = state.players.every((p) => p.ready);
      btnStart.disabled = !allReady;
    } else {
      btnReady.classList.remove('hidden');
      btnStart.classList.add('hidden');
      const me = state.players.find((p) => p.id === state.myId);
      btnReady.textContent = me && me.ready ? '準備を解除' : '準備完了にする';
    }
  }

  // ルーム作成・参加・CPUモード開始
  async function handleCreateRoom() {
    state.myName = $('input-player-name').value.trim() || 'プレイヤー1';
    const btn = $('btn-create-room');
    btn.disabled = true;
    btn.textContent = 'ルーム作成中…';
    try {
      const { roomCode, peerId } = await network.createRoom(state.myName);
      state.mode = 'online_host';
      state.myId = peerId;
      state.roomCode = roomCode;
      state.players = [createPlayerObj(peerId, state.myName, true, false, true)];
      renderWaitingRoom();
      showView('view-waiting');
      showToast(`ルーム ${roomCode} を作成しました`);
    } catch (err) {
      showToast(err.message || 'ルーム作成に失敗しました', true);
    } finally {
      btn.disabled = false;
      btn.textContent = '新しいルームを作成';
    }
  }

  async function handleJoinRoom(codeOverride = null) {
    state.myName = $('input-player-name').value.trim() || 'ゲスト';
    const code = codeOverride || $('input-room-code').value;
    const btn = $('btn-join-room');
    btn.disabled = true;
    btn.textContent = '接続中…';
    try {
      const { roomCode, peerId } = await network.joinRoom(code, state.myName);
      state.mode = 'online_guest';
      state.myId = peerId;
      state.roomCode = roomCode;
      state.players = [];
      renderWaitingRoom();
      showView('view-waiting');
      showToast(`ルーム ${roomCode} に接続しました`);
    } catch (err) {
      showToast(err.message || '入室できませんでした', true);
    } finally {
      btn.disabled = false;
      btn.textContent = '入室';
    }
  }

  function handleStartCpuLobby() {
    state.myName = $('input-player-name').value.trim() || 'あなた';
    state.cpuLevel = $('select-cpu-level').value;
    state.mode = 'cpu';
    state.myId = 'self';
    state.players = [createPlayerObj('self', state.myName, true, false, true)];
    if (state.cpuLevel !== 'solo') {
      const labelMap = { easy: 'CPU（初級）', normal: 'CPU（中級）', hard: 'CPU（上級）' };
      state.players.push(createPlayerObj('cpu', labelMap[state.cpuLevel], false, true, true));
    }
    renderWaitingRoom();
    showView('view-waiting');
  }

  function createPlayerObj(id, name, isHost, isCpu, ready) {
    return {
      id,
      name,
      isHost,
      isCpu,
      ready,
      score: 0,
      takes: 0,
      misses: 0,
      reactionTimes: [],
      lockedUntil: 0
    };
  }

  // ネットワークメッセージ処理
  function handleNetworkMessage(data, senderPeerId) {
    if (!data || !data.type) return;

    if (state.mode === 'online_host') {
      if (data.type === 'join') {
        if (state.players.length >= 4) {
          showToast('ルームが満員のため接続を拒否しました');
          return;
        }
        if (!state.players.some((p) => p.id === senderPeerId)) {
          state.players.push(createPlayerObj(senderPeerId, data.name || 'ゲスト', false, false, false));
        }
        syncLobbyToGuests();
        renderWaitingRoom();
        showToast(`${data.name || 'ゲスト'} が入室しました`);
      } else if (data.type === 'ready') {
        const p = state.players.find((pl) => pl.id === senderPeerId);
        if (p) {
          p.ready = Boolean(data.ready);
          syncLobbyToGuests();
          renderWaitingRoom();
        }
      } else if (data.type === 'pick') {
        processPickAttempt(senderPeerId, data.cardId, data.clientElapsedMs);
      }
    } else if (state.mode === 'online_guest') {
      if (data.type === 'lobby_sync') {
        state.players = data.players;
        state.settings = data.settings;
        if (data.decksMeta) {
          // ゲスト画面のデッキ名表示用
          const exists = state.decks.some((d) => d.id === data.decksMeta.id);
          if (!exists) {
            state.decks.push(data.decksMeta);
            populateDeckSelects();
          }
        }
        renderWaitingRoom();
      } else if (data.type === 'game_start') {
        startClientGameView(data.fieldCards, data.totalRounds, data.deckTitle, data.players);
      } else if (data.type === 'round_start') {
        startClientRound(data.roundIndex, data.card);
      } else if (data.type === 'round_result') {
        applyRoundResult(data.winnerId, data.winnerName, data.cardId, data.elapsedMs, data.players);
      } else if (data.type === 'miss') {
        applyMissPenalty(data.playerId, data.playerName, data.cardId, data.players);
      } else if (data.type === 'game_over') {
        finishGame(data.players);
      } else if (data.type === 'abort') {
        cleanupGameTimers();
        audio.stopSpeech();
        showView('view-waiting');
        showToast('ホストが対局を中断しました');
      }
    }
  }

  function handlePeerDisconnected(peerId) {
    if (state.mode !== 'online_host') return;
    const leaving = state.players.find((p) => p.id === peerId);
    state.players = state.players.filter((p) => p.id !== peerId);
    if (leaving) showToast(`${leaving.name} が退出しました`);
    syncLobbyToGuests();
    renderWaitingRoom();
  }

  function handleHostDisconnected() {
    cleanupGameTimers();
    audio.stopSpeech();
    network.destroy();
    showToast('ホストとの接続が切れました', true);
    showView('view-lobby');
  }

  function syncLobbyToGuests() {
    if (state.mode !== 'online_host') return;
    const deck = getSelectedDeck();
    network.broadcast({
      type: 'lobby_sync',
      players: state.players,
      settings: state.settings,
      decksMeta: { id: deck.id, title: deck.title, description: deck.description, cards: deck.cards }
    });
  }

  // ゲーム開始（ホストまたはCPUモード）
  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function startHostGame() {
    const deck = getSelectedDeck();
    if (!deck || deck.cards.length < 1) {
      showToast('デッキに札がありません。「札の管理」から1枚以上追加してください', true);
      return;
    }
    const desiredField = state.settings.fieldCount === 'all' ? deck.cards.length : Math.min(Number(state.settings.fieldCount) || 12, deck.cards.length);
    const fieldCards = shuffle(deck.cards).slice(0, desiredField);
    const rawMax = state.settings.rounds === 'all' ? fieldCards.length : Math.min(Number(state.settings.rounds) || 10, fieldCards.length);
    // 場札が2枚以上のときはラスト1枚を残して終了する
    const maxRounds = fieldCards.length >= 2 ? Math.min(rawMax, fieldCards.length - 1) : rawMax;
    const deckQueue = shuffle(fieldCards).slice(0, maxRounds);

    state.players.forEach((p) => {
      p.score = 0;
      p.takes = 0;
      p.misses = 0;
      p.reactionTimes = [];
      p.lockedUntil = 0;
    });

    state.game.deckQueue = deckQueue;
    state.game.totalRounds = maxRounds;

    if (state.mode === 'online_host') {
      network.broadcast({
        type: 'game_start',
        fieldCards,
        totalRounds: maxRounds,
        deckTitle: deck.title,
        players: state.players
      });
    }

    startClientGameView(fieldCards, maxRounds, deck.title, state.players);
    scheduleNextHostRound(900);
  }

  function startClientGameView(fieldCards, totalRounds, deckTitle, players) {
    cleanupGameTimers();
    state.players = players;
    state.game.active = true;
    state.game.fieldCards = fieldCards;
    state.game.takenIds = new Set();
    state.game.roundIndex = 0;
    state.game.totalRounds = totalRounds;
    state.game.currentCard = null;
    state.game.roundOpen = false;

    $('hud-deck-name').textContent = deckTitle;
    $('hud-total-rounds').textContent = String(totalRounds);
    $('game-banner').classList.add('hidden');
    $('yomi-text').textContent = '札を並べています…';
    $('yomi-phase-label').textContent = '準備中';
    $('yomi-phase-label').className = 'phase-tag waiting';
    $('yomi-timer').textContent = '0.00s';
    $('yomi-progress-bar').style.width = '0%';
    const progressTrack = document.querySelector('.yomi-progress-track');
    if (progressTrack) {
      progressTrack.classList.toggle('hidden', state.mode !== 'cpu');
    }

    renderScoreboard();
    renderToriGrid();
    showView('view-game');
    audio.playHyoshigi();
  }

  function scheduleNextHostRound(delayMs = 1500) {
    clearTimeout(state.game.nextRoundTimeout);
    state.game.nextRoundTimeout = setTimeout(() => {
      if (!state.game.active) return;
      const remainingField = state.game.fieldCards.length - state.game.takenIds.size;
      if (state.game.roundIndex >= state.game.deckQueue.length || (state.game.fieldCards.length >= 2 && remainingField <= 1)) {
        if (state.mode === 'online_host') {
          network.broadcast({ type: 'game_over', players: state.players });
        }
        finishGame(state.players);
        return;
      }
      const nextCard = state.game.deckQueue[state.game.roundIndex];
      const nextIdx = state.game.roundIndex + 1;
      if (state.mode === 'online_host') {
        network.broadcast({ type: 'round_start', roundIndex: nextIdx, card: nextCard });
      }
      startClientRound(nextIdx, nextCard);
    }, delayMs);
  }

  function startClientRound(roundIndex, card) {
    cleanupGameTimers();
    state.game.roundIndex = roundIndex;
    state.game.currentCard = card;
    state.game.roundOpen = true;
    state.game.roundStartTime = performance.now();

    $('hud-round').textContent = String(roundIndex);
    $('game-banner').classList.add('hidden');
    $('yomi-phase-label').textContent = '読み上げ中！';
    $('yomi-phase-label').className = 'phase-tag';
    $('yomi-progress-bar').style.width = '0%';

    const dMode = state.settings.displayMode;
    if (dMode === 'voice_only') {
      $('yomi-text').textContent = '🔊 音声を聞いて札を取ってください';
    } else {
      $('yomi-text').textContent = card.yomi;
    }

    if (dMode !== 'text_only') {
      const rate = parseFloat(state.settings.speechRate) || 1.0;
      audio.speak(card.reading || card.yomi, rate);
    }

    // 経過時間タイマー
    state.game.timerInterval = setInterval(() => {
      if (!state.game.roundOpen) return;
      const elapsed = (performance.now() - state.game.roundStartTime) / 1000;
      $('yomi-timer').textContent = elapsed.toFixed(2) + 's';
      const pct = Math.min(100, (elapsed / 6) * 100);
      $('yomi-progress-bar').style.width = pct + '%';
    }, 50);

    // CPU の反応予約（全体的に優しめの反応速度）
    if (state.mode === 'cpu' && state.cpuLevel !== 'solo') {
      const baseMs = state.cpuLevel === 'easy' ? 5000 : state.cpuLevel === 'hard' ? 2200 : 3500;
      const jitter = (Math.random() - 0.3) * 900;
      const minMs = state.cpuLevel === 'easy' ? 3500 : state.cpuLevel === 'hard' ? 1500 : 2400;
      const delay = Math.max(minMs, baseMs + jitter);
      state.game.cpuTimeout = setTimeout(() => {
        if (state.game.active && state.game.roundOpen) {
          processPickAttempt('cpu', card.id, Math.round(delay));
        }
      }, delay);
    }
  }

  function onToriCardClick(cardId) {
    if (!state.game.active || !state.game.roundOpen) return;
    if (state.game.takenIds.has(cardId)) return;

    const me = state.players.find((p) => p.id === state.myId);
    if (me && Date.now() < me.lockedUntil) {
      showToast('お手つきロック中です！', true);
      return;
    }

    const elapsedMs = Math.round(performance.now() - state.game.roundStartTime);
    if (state.mode === 'online_guest') {
      network.sendToHost({ type: 'pick', cardId, clientElapsedMs: elapsedMs });
    } else {
      processPickAttempt(state.myId, cardId, elapsedMs);
    }
  }

  function processPickAttempt(playerId, cardId, elapsedMs) {
    if (!state.game.active || !state.game.roundOpen) return;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    if (Date.now() < player.lockedUntil) return;

    const current = state.game.currentCard;
    if (!current) return;

    if (cardId === current.id) {
      // 正解・先着確定
      state.game.roundOpen = false;
      player.takes += 1;
      player.score += 1;
      player.reactionTimes.push(elapsedMs || 0);

      if (state.mode === 'online_host') {
        network.broadcast({
          type: 'round_result',
          winnerId: player.id,
          winnerName: player.name,
          cardId,
          elapsedMs,
          players: state.players
        });
      }
      applyRoundResult(player.id, player.name, cardId, elapsedMs, state.players);
      scheduleNextHostRound(1650);
    } else {
      // お手つき
      player.misses += 1;
      const rule = state.settings.otetsuki;
      if (rule === 'lock' || rule === 'minus') {
        player.lockedUntil = Date.now() + 3000;
      }
      if (rule === 'minus') {
        player.score -= 1;
      }
      if (state.mode === 'online_host') {
        network.broadcast({
          type: 'miss',
          playerId: player.id,
          playerName: player.name,
          cardId,
          players: state.players
        });
      }
      applyMissPenalty(player.id, player.name, cardId, state.players);
    }
  }

  function applyRoundResult(winnerId, winnerName, cardId, elapsedMs, updatedPlayers) {
    clearInterval(state.game.timerInterval);
    clearTimeout(state.game.cpuTimeout);
    state.game.roundOpen = false;
    state.game.takenIds.add(cardId);
    state.players = updatedPlayers;

    audio.stopSpeech();
    audio.playTake();

    const cardEl = document.querySelector(`.tori-card[data-card-id="${cardId}"]`);
    if (cardEl) {
      cardEl.classList.add('correct-flash');
      setTimeout(() => cardEl.classList.add('taken'), 420);
    }

    const banner = $('game-banner');
    banner.textContent = `✨ ${winnerName} が獲得！（${(elapsedMs / 1000).toFixed(2)}秒）`;
    banner.className = 'game-banner win';
    $('yomi-phase-label').textContent = '決着！';
    $('yomi-phase-label').className = 'phase-tag waiting';
    // 音声のみモードでも答えの読み札を表示する
    if (state.game.currentCard) {
      $('yomi-text').textContent = state.game.currentCard.yomi;
    }

    renderScoreboard();
  }

  function applyMissPenalty(playerId, playerName, cardId, updatedPlayers) {
    state.players = updatedPlayers;
    if (playerId === state.myId) {
      const rule = state.settings.otetsuki;
      const me = state.players.find((p) => p.id === state.myId);
      if (me && (rule === 'lock' || rule === 'minus')) {
        me.lockedUntil = Date.now() + 3000;
        setTimeout(renderScoreboard, 3050);
      }
      audio.playMiss();
    }
    const cardEl = document.querySelector(`.tori-card[data-card-id="${cardId}"]`);
    if (cardEl) {
      cardEl.classList.add('wrong-flash');
      setTimeout(() => cardEl.classList.remove('wrong-flash'), 420);
    }
    const banner = $('game-banner');
    banner.textContent = `⚠️ ${playerName} お手つき！`;
    banner.className = 'game-banner miss';
    renderScoreboard();
  }

  function finishGame(finalPlayers) {
    cleanupGameTimers();
    audio.stopSpeech();
    audio.playFanfare();
    state.game.active = false;
    state.players = finalPlayers;

    const sorted = finalPlayers.slice().sort((a, b) => b.score - a.score || b.takes - a.takes);
    const top = sorted[0];
    $('result-headline').textContent =
      sorted.length === 1
        ? `完走！ ${top.takes}枚獲得`
        : `${top.name} の勝利！`;
    const leftCount = Math.max(0, state.game.fieldCards.length - state.game.takenIds.size);
    $('result-subtext').textContent = leftCount === 1
      ? `ラスト1枚を残して対局終了（全 ${state.game.roundIndex} 問）。`
      : `全 ${state.game.totalRounds} 問の対局が完了しました。`;

    const tbody = $('result-tbody');
    tbody.innerHTML = '';
    sorted.forEach((p, idx) => {
      const avg = p.reactionTimes && p.reactionTimes.length
        ? (p.reactionTimes.reduce((s, v) => s + v, 0) / p.reactionTimes.length / 1000).toFixed(2) + '秒'
        : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}位</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${p.takes}枚</td>
        <td><strong>${p.score}点</strong></td>
        <td>${p.misses}回</td>
        <td>${avg}</td>
      `;
      tbody.appendChild(tr);
    });

    showView('view-result');
  }

  function renderScoreboard() {
    const board = $('hud-scoreboard');
    board.innerHTML = '';
    const now = Date.now();
    state.players.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'score-chip' + (p.id === state.myId ? ' is-self' : '') + (p.lockedUntil > now ? ' is-locked' : '');
      chip.innerHTML = `<span>${escapeHtml(p.name)}</span><strong>${p.score}</strong>`;
      board.appendChild(chip);
    });
  }

  function renderToriGrid() {
    const grid = $('tori-grid');
    grid.innerHTML = '';
    state.game.fieldCards.forEach((card, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tori-card' + (state.game.takenIds.has(card.id) ? ' taken' : '');
      btn.dataset.cardId = card.id;
      const keyLabel = KEY_BINDINGS[idx] || '';

      btn.innerHTML = `
        <span class="tori-head-seal">${escapeHtml(card.head || card.tori.charAt(0))}</span>
        ${keyLabel ? `<span class="tori-key-hint ${state.game.showKeyHints ? '' : 'hidden'}">${keyLabel}</span>` : ''}
        <span class="tori-body-text">${escapeHtml(card.tori)}</span>
      `;
      btn.addEventListener('click', () => onToriCardClick(card.id));
      grid.appendChild(btn);
    });
  }

  function cleanupGameTimers() {
    clearInterval(state.game.timerInterval);
    clearTimeout(state.game.cpuTimeout);
    clearTimeout(state.game.nextRoundTimeout);
    state.game.timerInterval = null;
    state.game.cpuTimeout = null;
    state.game.nextRoundTimeout = null;
  }

  // 札リストエディタ
  function renderEditorTable() {
    const deck = state.decks.find((d) => d.id === state.editorDeckId) || state.decks[0];
    if (!deck) return;
    const tbody = $('editor-card-tbody');
    tbody.innerHTML = '';
    if (deck.cards.length === 0) {
      const emptyTr = document.createElement('tr');
      emptyTr.innerHTML = '<td colspan="5" class="muted-note" style="text-align:center;padding:1.25rem;">まだ札が登録されていません。上のフォームまたは「JSON読込」から追加してください。</td>';
      tbody.appendChild(emptyTr);
      return;
    }
    deck.cards.forEach((c) => {
      const tr = document.createElement('tr');
      if (state.editingCardId === c.id) {
        tr.innerHTML = `
          <td><input type="text" class="inline-edit-input" data-field="head" maxlength="2" value="${escapeHtml(c.head || '')}"></td>
          <td><input type="text" class="inline-edit-input" data-field="yomi" value="${escapeHtml(c.yomi)}"></td>
          <td><input type="text" class="inline-edit-input" data-field="tori" value="${escapeHtml(c.tori)}"></td>
          <td><input type="text" class="inline-edit-input" data-field="reading" value="${escapeHtml(c.reading || '')}"></td>
          <td>
            <div class="editor-inline-actions">
              <button type="button" class="btn btn-small btn-matcha btn-save-card" data-id="${escapeHtml(c.id)}">保存</button>
              <button type="button" class="btn btn-small btn-outline btn-cancel-edit">取消</button>
            </div>
          </td>
        `;
      } else {
        tr.innerHTML = `
          <td><strong>${escapeHtml(c.head || '')}</strong></td>
          <td>${escapeHtml(c.yomi)}</td>
          <td>${escapeHtml(c.tori)}</td>
          <td class="muted-note">${escapeHtml(c.reading || '')}</td>
          <td>
            <div class="editor-inline-actions">
              <button type="button" class="btn btn-small btn-outline btn-edit-card" data-id="${escapeHtml(c.id)}">編集</button>
              <button type="button" class="btn btn-small btn-danger-outline btn-del-card" data-id="${escapeHtml(c.id)}">削除</button>
            </div>
          </td>
        `;
      }
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-card').forEach((b) => {
      b.addEventListener('click', () => {
        state.editingCardId = b.dataset.id;
        renderEditorTable();
      });
    });

    tbody.querySelectorAll('.btn-cancel-edit').forEach((b) => {
      b.addEventListener('click', () => {
        state.editingCardId = null;
        renderEditorTable();
      });
    });

    tbody.querySelectorAll('.btn-save-card').forEach((b) => {
      b.addEventListener('click', () => {
        const row = b.closest('tr');
        const head = row.querySelector('[data-field="head"]').value.trim();
        const yomi = row.querySelector('[data-field="yomi"]').value.trim();
        const tori = row.querySelector('[data-field="tori"]').value.trim() || yomi;
        const reading = row.querySelector('[data-field="reading"]').value.trim() || yomi;
        if (!head || !yomi) {
          showToast('頭文字と読み札の文は必須です', true);
          return;
        }
        const target = deck.cards.find((item) => item.id === b.dataset.id);
        if (target) {
          target.head = head;
          target.yomi = yomi;
          target.tori = tori;
          target.reading = reading;
        }
        state.editingCardId = null;
        saveDecksToLocal();
        populateDeckSelects();
        renderEditorTable();
        showToast('札の内容を更新しました');
      });
    });

    tbody.querySelectorAll('.btn-del-card').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.editingCardId === b.dataset.id) state.editingCardId = null;
        deck.cards = deck.cards.filter((item) => item.id !== b.dataset.id);
        saveDecksToLocal();
        populateDeckSelects();
        renderEditorTable();
        showToast('札を削除しました');
      });
    });
  }

  function exportCardsJson() {
    const payload = {
      version: '1.0.0',
      updatedAt: new Date().toISOString().slice(0, 10),
      decks: state.decks
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cards.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('cards.json をダウンロードしました');
  }

  function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(`${label}をコピーしました`)).catch(() => fallbackCopy(text, label));
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(`${label}をコピーしました`);
    } catch (_) {
      showToast('コピーに失敗しました', true);
    }
    ta.remove();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // イベントバインド
  function bindEvents() {
    $('btn-home-brand').addEventListener('click', () => {
      if (state.game.active) return;
      showView('view-lobby');
    });

    $('btn-toggle-sound').addEventListener('click', () => {
      audio.setEnabled(!audio.enabled);
      $('sound-icon').textContent = audio.enabled ? '🔊' : '🔇';
      $('btn-toggle-sound').querySelector('.btn-label').textContent = audio.enabled ? '音声ON' : '音声OFF';
    });

    $('btn-open-help').addEventListener('click', () => $('modal-help').classList.remove('hidden'));
    $('btn-close-help').addEventListener('click', () => $('modal-help').classList.add('hidden'));
    $('modal-help-backdrop').addEventListener('click', () => $('modal-help').classList.add('hidden'));

    $('btn-open-editor').addEventListener('click', () => {
      if (state.game.active) {
        showToast('対局中は札リストを編集できません', true);
        return;
      }
      const active = document.querySelector('.view.active');
      state.previousView = active ? active.id : 'view-lobby';
      renderEditorTable();
      showView('view-editor');
    });
    $('btn-close-editor').addEventListener('click', () => showView(state.previousView || 'view-lobby'));

    $('btn-create-room').addEventListener('click', handleCreateRoom);
    $('btn-join-room').addEventListener('click', () => handleJoinRoom());
    $('btn-start-cpu-lobby').addEventListener('click', handleStartCpuLobby);

    $('btn-copy-code').addEventListener('click', () => copyText(state.roomCode, 'ルームID'));
    $('btn-copy-url').addEventListener('click', () => {
      const url = new URL(global.location.href);
      url.searchParams.set('room', state.roomCode);
      copyText(url.toString(), '招待URL');
    });

    // ルール設定変更
    ['setting-deck', 'setting-rounds', 'setting-field-count', 'setting-display-mode', 'setting-otetsuki', 'setting-speech-rate'].forEach((id) => {
      $(id).addEventListener('change', () => {
        state.settings.deckId = $('setting-deck').value;
        state.settings.rounds = $('setting-rounds').value;
        state.settings.fieldCount = $('setting-field-count').value;
        state.settings.displayMode = $('setting-display-mode').value;
        state.settings.otetsuki = $('setting-otetsuki').value;
        state.settings.speechRate = $('setting-speech-rate').value;
        renderWaitingRoom();
        syncLobbyToGuests();
      });
    });

    $('btn-toggle-ready').addEventListener('click', () => {
      const me = state.players.find((p) => p.id === state.myId);
      const next = !(me && me.ready);
      if (me) me.ready = next;
      network.sendToHost({ type: 'ready', ready: next });
      renderWaitingRoom();
    });

    $('btn-start-game').addEventListener('click', startHostGame);

    $('btn-leave-room').addEventListener('click', () => {
      network.destroy();
      showView('view-lobby');
    });

    $('btn-toggle-keyhints').addEventListener('click', () => {
      state.game.showKeyHints = !state.game.showKeyHints;
      document.querySelectorAll('.tori-key-hint').forEach((el) => {
        el.classList.toggle('hidden', !state.game.showKeyHints);
      });
    });

    $('btn-abort-game').addEventListener('click', () => {
      cleanupGameTimers();
      audio.stopSpeech();
      state.game.active = false;
      if (state.mode === 'online_host') {
        network.broadcast({ type: 'abort' });
      }
      showView('view-waiting');
    });

    $('btn-back-waiting').addEventListener('click', () => {
      renderWaitingRoom();
      showView('view-waiting');
    });

    $('btn-back-lobby-from-result').addEventListener('click', () => {
      network.destroy();
      showView('view-lobby');
    });

    // キーボードショートカットで札を取る
    global.addEventListener('keydown', (e) => {
      if (!state.game.active || !state.game.roundOpen) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const key = e.key.toUpperCase();
      const idx = KEY_BINDINGS.indexOf(key);
      if (idx !== -1 && state.game.fieldCards[idx]) {
        onToriCardClick(state.game.fieldCards[idx].id);
      }
    });

    // エディタ操作
    $('editor-select-deck').addEventListener('change', (e) => {
      state.editorDeckId = e.target.value;
      renderEditorTable();
    });

    $('form-add-card').addEventListener('submit', (e) => {
      e.preventDefault();
      const deck = state.decks.find((d) => d.id === state.editorDeckId);
      if (!deck) return;
      const head = $('new-card-head').value.trim();
      const yomi = $('new-card-yomi').value.trim();
      const tori = $('new-card-tori').value.trim() || yomi;
      const reading = $('new-card-reading').value.trim() || yomi;
      if (!head || !yomi) return;

      deck.cards.push({
        id: 'c_' + Date.now().toString(36),
        head,
        yomi,
        tori,
        reading
      });
      saveDecksToLocal();
      populateDeckSelects();
      renderEditorTable();
      e.target.reset();
      showToast('新しい札を追加しました');
    });

    $('btn-new-deck').addEventListener('click', () => {
      const newId = 'custom_' + Date.now().toString(36);
      const count = state.decks.length + 1;
      state.decks.push({
        id: newId,
        title: `オリジナルデッキ ${count}`,
        description: 'カスタム追加されたカルタデッキ',
        cards: []
      });
      state.editorDeckId = newId;
      saveDecksToLocal();
      populateDeckSelects();
      renderEditorTable();
      showToast('新しいデッキを作成しました');
    });

    $('btn-export-json').addEventListener('click', exportCardsJson);

    $('input-import-json').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result);
          if (!json || !Array.isArray(json.decks) || json.decks.length === 0) {
            throw new Error('decks配列が見つかりません');
          }
          state.decks = json.decks;
          state.editorDeckId = state.decks[0].id;
          state.settings.deckId = state.decks[0].id;
          saveDecksToLocal();
          populateDeckSelects();
          renderEditorTable();
          showToast('JSONを読み込みました');
        } catch (err) {
          showToast(`JSON形式エラー: ${err.message}`, true);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('btn-reset-decks').addEventListener('click', async () => {
      try { localStorage.removeItem(STORAGE_KEY_DECKS); } catch (_) {}
      await loadDecks();
      renderEditorTable();
      showToast('初期札リストに戻しました');
    });
  }

  // 初期化
  async function init() {
    await loadDecks();
    bindEvents();

    // URLパラメータ ?room=XXXXXX がある場合は自動入力
    try {
      const params = new URLSearchParams(global.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
        $('input-room-code').value = roomParam.toUpperCase();
        showToast(`招待ルーム ${roomParam.toUpperCase()} が入力されました。「入室」を押してください`);
      }
    } catch (_) {}
  }

  global.addEventListener('DOMContentLoaded', init);
})(window);
