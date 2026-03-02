import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "chat-companion-stats";
const extensionWebPath = import.meta.url.replace(/\/index\.js$/, '');
const DEBUG = true;

jQuery(async () => {
  // 加载CSS文件 using dynamic path
  $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionWebPath}/styles.css">`);

  // 加载自定义字体 (Added handwritten and PING FANG SHAO HUA font)
  $('head').append(`<style>
    @import url("https://fontsapi.zeoseven.com/19/main/result.css");
    @import url("https://fontsapi.zeoseven.com/157/main/result.css");
    @import url("https://fonts.googleapis.com/css2?family=Long+Cang&display=swap");
    
    #ccs-preview-container.loading-preview {
      position: relative;
      min-height: 200px;
    }
    #ccs-preview-container.loading-preview::after {
      content: "正在生成卡片...";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 16px;
      color: #333;
      border-radius: 5px;
      z-index: 10;
    }
  </style>`);

  let shareStyle = 'modern-light';

  // 加载HTML using dynamic path with cache buster
  const settingsHtml = await $.get(`${extensionWebPath}/settings.html?v=${Date.now()}`);
  $("#extensions_settings").append(settingsHtml);

  // 确保模态框初始状态是隐藏的
  $("#ccs-preview-modal").hide();

  function getCurrentCharacterName() {
    // 从聊天消息中获取非用户消息的 ch_name
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const chName = msg.getAttribute('ch_name');
        if (chName) return chName;
      }
    }

    // 备用方法：从选中的角色按钮获取
    const selectedChar = document.querySelector('#rm_button_selected_ch h2');
    if (selectedChar?.textContent) {
      return selectedChar.textContent.trim();
    }

    return "未知角色";
  }

  // Helper function to parse SillyTavern's date format more reliably
  // Use both full month names and 3-letter abbreviations
  const monthMap = {
    Jan: '01', January: '01',
    Feb: '02', February: '02',
    Mar: '03', March: '03',
    Apr: '04', April: '04',
    May: '05', May: '05',
    Jun: '06', June: '06',
    Jul: '07', July: '07',
    Aug: '08', August: '08',
    Sep: '09', September: '09',
    Oct: '10', October: '10',
    Nov: '11', November: '11',
    Dec: '12', December: '12'
  };

  function parseSillyTavernDate(dateString) {
    if (DEBUG) console.log(`Attempting to parse date: "${dateString}"`);
    if (!dateString) {
      if (DEBUG) console.log("Date string is empty, returning null.");
      return null;
    }

    // Try parsing the specific format "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (DEBUG) console.log("Regex match result (parts):", parts);
    if (parts) {
      console.log("Regex matched specific format.");
      const monthName = parts[1];
      const day = parts[2];
      const year = parts[3];
      let hour = parseInt(parts[4], 10);
      const minute = parts[5];
      const ampm = parts[6].toLowerCase();
      if (DEBUG) console.log(`Parsed parts: Month=${monthName}, Day=${day}, Year=${year}, Hour=${hour}, Minute=${minute}, AMPM=${ampm}`);

      const monthNumber = monthMap[monthName];
      if (!monthNumber) {
        if (DEBUG) console.warn(`Unknown month name "${monthName}" in date string: ${dateString}`);
        return null;
      }
      if (DEBUG) console.log(`Month number: ${monthNumber}`);

      if (ampm === 'pm' && hour !== 12) {
        hour += 12;
        if (DEBUG) console.log(`Adjusted hour for PM: ${hour}`);
      } else if (ampm === 'am' && hour === 12) {
        hour = 0;
        if (DEBUG) console.log(`Adjusted hour for 12 AM: ${hour}`);
      }

      // Construct an ISO-like string that new Date() handles reliably
      const isoLikeString = `${year}-${monthNumber}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00`;
      if (DEBUG) console.log(`Constructed ISO-like string: ${isoLikeString}`);
      const date = new Date(isoLikeString);
      if (DEBUG) console.log(`Result of new Date(isoLikeString): ${date}`);
      const isValid = date && !isNaN(date.getTime());
      if (DEBUG) console.log(`Is parsed date valid? ${isValid}`);
      return isValid ? date : null;
    }

    if (DEBUG) console.log("Regex did not match specific format, trying fallback.");
    // Fallback: Try direct parsing for other potential formats
    const fallbackDate = new Date(dateString);
    if (DEBUG) console.log(`Result of fallback new Date(dateString): ${fallbackDate}`);
    const isFallbackValid = fallbackDate && !isNaN(fallbackDate.getTime());
    if (DEBUG) console.log(`Is fallback date valid? ${isFallbackValid}`);
    return isFallbackValid ? fallbackDate : null;
  }

  // 从文件名解析时间
  function parseTimeFromFilename(filename) {
    // 从文件名中提取日期和时间
    const match = filename.match(/(\d{4}-\d{2}-\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
    if (match) {
      const [_, date, hours, minutes, seconds] = match;
      const totalSeconds = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10);

      // 构建日期对象 (注意：Date.parse 也支持 YYYY-MM-DDTHH:mm:ss 格式)
      const dateObject = new Date(`${date}T${hours}:${minutes}:${seconds}`);

      return {
        date,
        time: `${hours}:${minutes}:${seconds}`,
        fullDateTime: `${date} ${hours}:${minutes}:${seconds}`,
        totalSeconds,
        dateObject: !isNaN(dateObject.getTime()) ? dateObject : null
      };
    }
    return null;
  }

  // 格式化日期时间
  function formatDateTime(dateTimeString) {
    if (!dateTimeString) return "未知时间";
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) return "未知时间";

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${year}年${month}月${day}日 ${hours}点${minutes}分`;
  }

  // 格式化时长
  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  // 计算消息的字数 (核心过滤逻辑)
  function countWordsInMessage(message) {
    if (!message) return 0;

    let text = message;

    // 1. 深度正则过滤 (使用制作人排除法)
    try {
      // - 排除 think/thinking 块 (处理已完成和未完成的)
      text = text.replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除元数据标签及其中间内容
      text = text.replace(/\[finire\]/gi, '');
      text = text.replace(/<(finish|disclaimer)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除 HTML 注释 (包括 draft/confirm)
      text = text.replace(/<!--[\s\S]*?-->/g, '');

      // - 排除特定的系统/UI标签如 <DH_...>, <FH_...>
      text = text.replace(/<(DH|FH)_[^>]*>/gi, '');

      // - 排除特定的样式标记 (处理可能的兼容性)
      text = text.replace(/<p style[^>]*>/gi, '');
    } catch (reError) {
      if (DEBUG) console.warn('Regex filtering failed for a message:', reError);
    }

    // - 移除所有剩余的 HTML 标签
    text = text.replace(/<[^>]*>/g, '');

    // 2. 统计处理
    // 中/日/韩文字符
    const cjkChars = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g) || [];
    // 英文单词/拉丁单词
    const latinWords = text.match(/[a-zA-Z0-9]+/g) || [];

    return cjkChars.length + latinWords.length;
  }

  // 获取当前聊天的字数统计和大小
  function getCurrentChatStats() {
    const messages = document.querySelectorAll('#chat .mes');
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.querySelector('.mes_text')?.textContent || '';
      const isUser = message.getAttribute('is_user') === 'true';
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.getAttribute('ch_name') || '',
        send_date: message.getAttribute('send_date') || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2; // 加换行

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 构建针对特定路径的 fetch 请求
  async function fetchChatFile(path) {
    try {
      if (DEBUG) console.log(`Attempting fetch: ${path}`);
      const response = await fetch(path, { credentials: 'same-origin' });
      if (response.ok) {
        return await response.text();
      }
      if (DEBUG) console.warn(`Fetch failed for ${path}: ${response.status}`);
    } catch (e) {
      if (DEBUG) console.error(`Fetch error for ${path}:`, e);
    }
    return null;
  }

  // 获取单个聊天文件的统计数据 (带有路径回退逻辑)
  async function getChatFileStats(fileName) {
    const context = getContext();
    const charId = context.characterId;
    const encodedFileName = encodeURIComponent(fileName);
    let text = null;

    // 尝试方式 1: 基于 characterId (头像文件名)
    if (charId && typeof charId === 'string' && charId !== '0') {
      const lastDotIndex = charId.lastIndexOf('.');
      const folderName = lastDotIndex > 0 ? charId.substring(0, lastDotIndex) : charId;
      text = await fetchChatFile(`/chats/${folderName}/${encodedFileName}`);
    }

    // 尝试方式 2: 基于角色名 (从文件名解析)
    if (!text) {
      const characterName = fileName.split(' - ')[0];
      text = await fetchChatFile(`/chats/${encodeURIComponent(characterName)}/${encodedFileName}`);
    }

    if (!text) return { words: 0, count: 0, userCount: 0, earliestUserTime: null };

    try {
      const lines = text.trim().split('\n').filter(l => l.trim());
      let totalWords = 0;
      let validMessages = 0;
      let userMessages = 0;
      let earliestUserTimeInFile = null;

      lines.forEach(line => {
        try {
          const m = JSON.parse(line);
          // 确保是有效的消息对象
          if (m && (m.mes !== undefined || m.is_user !== undefined)) {
            totalWords += countWordsInMessage(m.mes || '');
            validMessages++;

            // 统计用户消息数并提取最早的用户时间
            if (m.is_user === true) {
              userMessages++;
              if (m.send_date) {
                const msgDate = parseSillyTavernDate(m.send_date);
                if (msgDate && (!earliestUserTimeInFile || msgDate < earliestUserTimeInFile)) {
                  earliestUserTimeInFile = msgDate;
                }
              }
            }
          }
        } catch (e) { }
      });

      return {
        words: totalWords,
        count: validMessages,
        userCount: userMessages,
        earliestTime: earliestUserTimeInFile
      };
    } catch (e) {
      if (DEBUG) console.error(`Parsing error for chat ${fileName}:`, e);
      return { words: 0, count: 0, userCount: 0, earliestTime: null };
    }
  }

  // 从消息数据中获取统计信息
  function getStatsFromMessages(messages) {
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.mes || '';
      const isUser = message.is_user;
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.ch_name || '',
        send_date: message.send_date || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2;

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 获取完整的统计数据
  async function getFullStats() {
    const context = getContext();
    // 兼容不同版本的 SillyTavern 字段名
    let characterId = context.characterId || context.character_id;

    if (DEBUG) console.log('Current Context:', context);

    if (!characterId) {
      if (DEBUG) console.log('未从 context 找到角色ID, 尝试从 DOM/全局变量获取');
      // 尝试从全局变量获取 (SillyTavern 常用变量)
      if (typeof window.selected_character !== 'undefined' && window.characters && window.characters[window.selected_character]) {
        characterId = window.characters[window.selected_character].avatar;
      }
    }

    if (!characterId) {
      if (DEBUG) console.log('仍然未找到当前角色ID');
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }

    try {
      const chats = await getPastCharacterChats(characterId);
      if (DEBUG) console.log(`获取到 ${characterId} 的聊天记录:`, chats);

      let totalMessagesFromChats = 0;
      let totalSizeKB = 0;
      let earliestTime = null;
      let totalDurationSeconds = 0;
      let totalSizeBytesRaw = 0;
      let maxMessagesInSingleChat = 0;
      const chatFilesCount = Array.isArray(chats) ? chats.length : 0;

      if (chatFilesCount === 0) {
        if (DEBUG) console.log('该角色尚无历史聊天记录');
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: null,
          totalDuration: 0,
          totalSizeBytes: 0,
          chatFilesCount: 0
        };
      }

      chats.forEach(chat => {
        // 使用元数据作为基础值
        const chatItems = parseInt(chat.chat_items) || 0;
        totalMessagesFromChats += chatItems;
        if (chatItems > maxMessagesInSingleChat) {
          maxMessagesInSingleChat = chatItems;
        }

        // 解析文件大小
        const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
        const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
        const sizeAsNumber = parseFloat(chat.file_size);

        if (sizeMatchMB) {
          totalSizeBytesRaw += parseFloat(sizeMatchMB[1]) * 1024 * 1024;
          totalSizeKB += parseFloat(sizeMatchMB[1]) * 1024;
        } else if (sizeMatchKB) {
          totalSizeBytesRaw += parseFloat(sizeMatchKB[1]) * 1024;
          totalSizeKB += parseFloat(sizeMatchKB[1]);
        } else if (!isNaN(sizeAsNumber)) {
          totalSizeBytesRaw += sizeAsNumber;
          totalSizeKB += sizeAsNumber / 1024;
        }

        // 积累时长 & 获取文件名作为初遇时间的参考（通常是文件创建时间）
        if (chat.file_name) {
          const timeInfo = parseTimeFromFilename(chat.file_name);
          if (timeInfo) {
            totalDurationSeconds += timeInfo.totalSeconds;
            // 文件名中的日期通常是该聊天的创建日期，很有参考价值
            if (timeInfo.dateObject && (!earliestTime || timeInfo.dateObject < earliestTime)) {
              earliestTime = timeInfo.dateObject;
              if (DEBUG) console.log('Based on filename, updated earliestTime to:', earliestTime);
            }
          }
        }

        // 解析初遇时间 (作为保底，metadata 通常记录的是文件的最后一条消息时间)
        if (chat.last_mes) {
          const date = parseSillyTavernDate(chat.last_mes);
          if (date && (!earliestTime || date < earliestTime)) {
            // 只有在没更好的数据时才用这个，或者这个确实更早
            earliestTime = date;
          }
        }
      });

      // 默认先使用估算值 (密度取 32.5)
      let estimatedWords = Math.round(totalSizeKB * 32.5);

      // 尝试进行真实全量统计
      try {
        let totalWordsCalculated = 0;
        let totalMessagesCalculated = 0;
        let totalUserMessagesCalculated = 0;
        let maxMessagesInScan = 0;
        let absoluteEarliestUserTime = null;
        let successCount = 0;

        const batchSize = 10;
        for (let i = 0; i < chats.length; i += batchSize) {
          const batch = chats.slice(i, i + batchSize);
          const results = await Promise.all(batch.map(chat => getChatFileStats(chat.file_name)));

          results.forEach(res => {
            if (res.count > 0 || res.words > 0) {
              totalWordsCalculated += res.words;
              totalMessagesCalculated += res.count;
              totalUserMessagesCalculated += (res.userCount || 0);
              successCount++;

              // 记录分析到的最大单次对话消息数
              if (res.count > maxMessagesInScan) {
                maxMessagesInScan = res.count;
              }

              // 寻找绝对最早的 *用户* 初遇时间
              if (res.earliestTime && (!absoluteEarliestUserTime || res.earliestTime < absoluteEarliestUserTime)) {
                absoluteEarliestUserTime = res.earliestTime;
              }
            }
          });
        }

        // 如果成功获取到了任何实际数据，以实测数据为准
        if (successCount > 0) {
          // 判定逻辑：必须至少有一条用户消息，且不能所有聊天都只有1条开场白 (以实测 count 为准)
          if (totalUserMessagesCalculated === 0 || maxMessagesInScan <= 1) {
            if (DEBUG) console.log(`判定为尚未互动: 用户发言=${totalUserMessagesCalculated}, 最大单场消息=${maxMessagesInScan}`);
            return {
              messageCount: 0,
              wordCount: 0,
              firstTime: null,
              totalDuration: 0,
              totalSizeBytes: totalSizeBytesRaw,
              chatFilesCount
            };
          }

          if (DEBUG) console.log(`全量真实统计成功: ${totalWordsCalculated} 字, 包含 ${totalUserMessagesCalculated} 条用户消息`);

          return {
            messageCount: totalMessagesCalculated,
            wordCount: totalWordsCalculated,
            firstTime: absoluteEarliestUserTime,
            totalDuration: totalDurationSeconds,
            totalSizeBytes: totalSizeBytesRaw,
            chatFilesCount
          };
        }
      } catch (sumError) {
        if (DEBUG) console.error('全量统计过程出错:', sumError);
      }

      // 回退逻辑 (如果全量统计失败，且元数据也没有显示任何有实质内容的会话)
      if (maxMessagesInSingleChat <= 1) {
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: null,
          totalDuration: 0,
          totalSizeBytes: totalSizeBytesRaw,
          chatFilesCount
        };
      }

      return {
        messageCount: totalMessagesFromChats,
        wordCount: estimatedWords,
        firstTime: earliestTime,
        totalDuration: totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw,
        chatFilesCount
      };
    } catch (error) {
      if (DEBUG) console.error('getFullStats 运行出错:', error);
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }
  }



  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 添加控制分享按钮状态的函数 (优先处理无互动状态)
  function updateShareButtonState(messageCount) {
    const $shareButton = $("#ccs-share");

    // Priority Check: Disable if total message count is 1 or less
    if (messageCount <= 1) {
      $shareButton.prop('disabled', true).val('尚未互动');
      if (DEBUG) console.log('updateShareButtonState: Disabled (messageCount <= 1)');
      return;
    }

    // If interaction exists (messageCount > 1), check if options are selected
    const anyOptionChecked = $('.ccs-share-option input[type="checkbox"]:checked').length > 0;

    if (anyOptionChecked) {
      $shareButton.prop('disabled', false).val('分享');
      if (DEBUG) console.log('updateShareButtonState: Enabled (options checked)');
    } else {
      $shareButton.prop('disabled', true).val('请选择内容');
      if (DEBUG) console.log('updateShareButtonState: Disabled (no options checked)');
    }
  }

  // 添加控制提示显示的函数
  function updateTipVisibility(messageCount, chatFilesCount) {
    const $tip = $("#ccs-tip");
    if (messageCount <= 2 && chatFilesCount > 1) {
      $tip.show();
    } else {
      $tip.hide();
    }
  }

  async function updateStats() {
    if (DEBUG) console.log('Attempting to update stats...');
    const characterName = getCurrentCharacterName();
    $("#ccs-character").text(characterName);
    try {
      const stats = await getFullStats();
      if (DEBUG) console.log('Stats received in updateStats:', stats);

      const chatFilesCount = stats.chatFilesCount || 0;

      // 始终显示字数估算提示
      $("#ccs-tip").show();

      if (!stats.firstTime) {
        if (DEBUG) console.log('No firstTime found in stats, zeroing UI');
        $("#ccs-messages").text("0");
        $("#ccs-words").text("0");
        $("#ccs-total-size").text("0 B");
        $("#ccs-start").text("尚未互动");
        $("#ccs-days").text("0");
        updateShareButtonState(0);
      } else {
        // 更新统计数据到UI
        $("#ccs-messages").text(stats.messageCount || 0);
        $("#ccs-words").text(stats.wordCount || 0);

        // Format total size dynamically (KB or MB)
        let formattedSize = '--';
        if (stats.totalSizeBytes !== undefined && stats.totalSizeBytes >= 0) {
          const bytes = stats.totalSizeBytes;
          const kb = bytes / 1024;
          const mb = kb / 1024;

          if (mb >= 1) {
            formattedSize = `${mb.toFixed(2)} MB`;
          } else if (kb >= 1) {
            formattedSize = `${kb.toFixed(2)} KB`;
          } else {
            formattedSize = `${bytes} B`; // Display bytes if less than 1 KB
          }
        }
        $("#ccs-total-size").text(formattedSize);

        const now = new Date();
        // Ensure stats.firstTime is a Date object
        const firstTimeDate = stats.firstTime instanceof Date ? stats.firstTime : new Date(stats.firstTime);
        if (DEBUG) console.log('First time date:', firstTimeDate);

        // 使用 UTC 日期来避免时区问题
        const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const utcFirstTime = Date.UTC(firstTimeDate.getFullYear(), firstTimeDate.getMonth(), firstTimeDate.getDate());

        // 计算天数：从第一次互动到现在的天数（包括今天）
        const diffTime = Math.abs(utcNow - utcFirstTime);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 加1确保包括今天
        if (DEBUG) console.log('Calculated days:', days);

        // 格式化初遇时间
        const firstTimeFormatted = formatDateTime(stats.firstTime);
        if (DEBUG) console.log('Formatted first time:', firstTimeFormatted);

        $("#ccs-start").text(firstTimeFormatted);
        $("#ccs-days").text(days);
        // Pass messageCount to the state function
        updateShareButtonState(stats.messageCount);
      }
      // Removed the stray 'else' block that was here


      if (DEBUG) {
        console.log('Stats UI updated:', {
          messages: stats.messageCount,
          words: stats.wordCount,
          firstTime: stats.firstTime,
          days: $("#ccs-days").text()
        });
      }

    } catch (error) {
      console.error('更新统计数据失败:', error);
      // 显示错误状态
      $("#ccs-messages").text('--');
      $("#ccs-words").text('--');
      $("#ccs-start").text('--');
      $("#ccs-days").text('--');
      $("#ccs-total-size").text('--'); // Clear size on error too
      updateShareButtonState(0); // Pass 0 on error to ensure disabled state
    }
  }

  function getCharacterAvatar() {
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar) {
          return avatar.src;
        }
      }
    }
    return null;
  }

  function getUserAvatar() {
    // Priority 1: Try to get avatar from current chat messages
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar && avatar.src) {
          if (DEBUG) console.log("getUserAvatar: Found avatar in chat message.");
          return avatar.src;
        }
      }
    }

    // Priority 2 (Fallback): Try to get avatar from persona selection
    const userAvatarContainer = document.querySelector('.avatar-container[data-avatar-id="user-default.png"]');
    if (userAvatarContainer) {
      const avatar = userAvatarContainer.querySelector('img');
      if (avatar && avatar.src) {
        if (DEBUG) console.log("getUserAvatar: Found avatar in persona selection.");
        return avatar.src;
      }
    }

    if (DEBUG) console.log("getUserAvatar: Could not find user avatar.");
    return null; // Return null if not found in either place
  }

  async function generateShareImage() {
    const canvas = document.getElementById('ccs-canvas');
    const ctx = canvas.getContext('2d');
    const charName = getCurrentCharacterName();

    const scaleFactor = 2;
    const width = 663 * scaleFactor;

    // Theme colors
    const isDark = shareStyle === 'modern-dark' || shareStyle === 'dark';
    const isModern = true; // All styles are now modern

    const tealColor = isDark ? '#2F3033' : '#F7F9FB';
    const cardBgColor = isDark ? '#2F3033' : '#F7F9FB';
    const contentAreaBg = isDark ? '#1C1D1E' : '#EFF2F4';
    const statBoxColor = isDark ? '#2F3033' : '#F7F9FB';
    const shadowColor = isDark ? 'rgba(19, 19, 19, 0.6)' : 'rgba(218, 227, 232, 0.6)';

    const statLabelColor = isDark ? '#FAFBF7' : '#131313';
    const statValueColor = isDark ? '#FAFBF7' : '#131313';
    const charNameColor = isDark ? '#FAFBF7' : '#131313';
    const dashColor = '#FFFFFF';

    // 0. 加载 Ins 风格专属资源 (Now only Background PNG)
    const insAssets = {};
    if (shareStyle === 'ins') {
      if (DEBUG) console.log('Loading ins background...');
      const v = Date.now();
      const assetList = {
        bg: `${extensionWebPath}/assets/mesh-bg.svg?v=${v}`
      };

      const loadAssetImg = (url) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeout = setTimeout(() => {
          console.warn(`Asset load timeout: ${url}`);
          resolve(null);
        }, 3000);
        img.onload = () => { clearTimeout(timeout); resolve(img); };
        img.onerror = () => { clearTimeout(timeout); resolve(null); };
        img.src = url;
      });

      await Promise.all(Object.entries(assetList).map(async ([key, url]) => {
        insAssets[key] = await loadAssetImg(url);
        if (DEBUG && !insAssets[key]) console.warn(`Failed to load asset: ${key} (${url})`);
      }));
      if (DEBUG) console.log('Ins background loaded status:', !!insAssets.bg);
    }

    // Instagram Icons from Figma (SVG Paths)
    const insIcons = {
      heart: "M11.8976 6.27131C10.4494 6.27131 9.02136 6.67963 7.75636 7.45391C3.84121 9.8537 2.46338 15.2115 4.73746 19.3927C5.16297 20.1757 5.92502 21.1161 6.90352 22.1348C7.87656 23.1479 9.04129 24.2159 10.2501 25.2538C12.6674 27.3296 15.2397 29.2672 16.7595 30.38C17.1237 30.6472 17.5519 30.7874 18.0014 30.7874C18.4499 30.7874 18.8787 30.6481 19.2507 30.3791C20.7708 29.2662 23.3423 27.329 25.759 25.2538C26.9678 24.2159 28.1325 23.1479 29.1056 22.1348C30.084 21.1161 30.846 20.1759 31.2715 19.3928C33.5395 15.2113 32.1614 9.85342 28.2461 7.45376C26.9812 6.67957 25.5533 6.27131 24.1052 6.27131C21.9353 6.27131 19.893 7.1469 18.3576 8.71504L18.0014 9.07882L17.6452 8.71504C16.1097 7.1469 14.0674 6.27131 11.8976 6.27131ZM7.23417 6.6235C8.65104 5.75626 10.2591 5.29407 11.8976 5.29407C14.1795 5.29407 16.3303 6.15441 18.0014 7.69084C19.6724 6.15441 21.8233 5.29407 24.1052 5.29407C25.7436 5.29407 27.3517 5.75626 28.7686 6.6235C33.1518 9.31001 34.6456 15.2437 32.1447 19.8543C31.6562 20.7532 30.8217 21.7688 29.8245 22.807C28.822 23.8509 27.6317 24.9413 26.4093 25.991C23.9641 28.0906 21.3687 30.0453 19.8399 31.1648L19.8376 31.1664C19.2991 31.5561 18.6656 31.7647 18.0014 31.7647C17.3376 31.7647 16.7028 31.5563 16.1688 31.1645C14.6398 30.045 12.0447 28.0904 9.59978 25.991C8.37732 24.9413 7.1871 23.8509 6.18452 22.807C5.18745 21.7689 4.35314 20.7536 3.86465 19.8547M7.23417 6.6235C2.85093 9.30999 1.35705 15.244 3.86465 19.8547L7.23417 6.6235ZM8.24008 8.20271C9.35301 7.52227 10.6131 7.15943 11.8976 7.15943C14.1508 7.15943 16.2355 8.23487 17.6384 10.0781L17.6398 10.08L18.0014 10.5598L18.3629 10.08L18.3644 10.0781C19.7674 8.23465 21.8585 7.15943 24.1052 7.15943C25.3893 7.15943 26.6497 7.52207 27.757 8.20314C31.3143 10.3816 32.5063 15.216 30.4619 18.9719C30.0038 19.8136 29.1685 20.7962 28.1725 21.8048C27.1688 22.8211 25.9724 23.893 24.7634 24.9147C22.3448 26.9586 19.8534 28.8208 18.7018 29.6659L18.6993 29.6677C18.2845 29.9682 17.7119 29.9682 17.2971 29.6677L17.2953 29.6664C16.1432 28.824 13.6517 26.9634 11.233 24.9194C10.024 23.8976 8.82753 22.8253 7.82382 21.8082C6.82784 20.7989 5.99264 19.8152 5.53458 18.9719M8.76233 9.03309C5.67779 10.9278 4.59369 15.1778 6.40722 18.5096C6.79678 19.2269 7.55089 20.1307 8.53354 21.1265C9.50862 22.1146 10.6806 23.1657 11.8774 24.1772C14.2698 26.199 16.7394 28.0436 17.8839 28.8804C17.9494 28.9275 18.0462 28.9276 18.1119 28.8809C19.2569 28.0405 21.7266 26.1943 24.119 24.1725C25.3159 23.161 26.4879 22.1102 27.463 21.1228C28.4457 20.1277 29.1996 19.2255 29.5892 18.5096C31.403 15.1774 30.3181 10.9214 27.2343 9.03322L27.2334 9.03268C26.2789 8.44548 25.1991 8.13668 24.1052 8.13668C22.1903 8.13668 20.3854 9.05082 19.1572 10.6639C19.1569 10.6643 19.1567 10.6646 19.1564 10.6649L18.0014 12.1978L16.8463 10.6649C16.8461 10.6645 16.8458 10.6642 16.8455 10.6639C15.6172 9.05058 13.8185 8.13668 11.8976 8.13668C10.804 8.13668 9.72394 8.44528 8.76233 9.03309ZM8.24008 8.20271C4.68354 10.387 3.48999 15.2155 5.53458 18.9719L8.24008 8.20271Z M17.9993 31.2354C17.444 31.2354 16.9139 31.0618 16.4659 30.7333C13.4243 28.5083 6.15464 22.9734 4.33092 19.6203C1.94558 15.2384 3.37805 9.61058 7.51769 7.0756C8.85551 6.25747 10.37 5.82361 11.9098 5.82361C14.2131 5.82361 16.3775 6.75331 17.9993 8.40817C19.6211 6.75331 21.7856 5.82361 24.0889 5.82361C25.6286 5.82361 27.1432 6.25747 28.481 7.0756C32.6206 9.61058 34.0531 15.2384 31.674 19.6203C29.8503 22.9734 22.5807 28.5083 19.5391 30.7333C19.0847 31.0618 18.5546 31.2354 17.9993 31.2354ZM11.9098 7.68301C10.7234 7.68301 9.55596 8.0177 8.52105 8.64989C5.20807 10.6828 4.07219 15.2074 5.99688 18.7402C7.68807 21.8516 15.2985 27.5662 17.5892 29.2396C17.8289 29.4132 18.1634 29.4132 18.4032 29.2396C20.6939 27.56 28.3043 21.8454 29.9955 18.7402C31.9202 15.2074 30.7843 10.6766 27.4713 8.64989C26.4427 8.0177 25.2753 7.68301 24.0889 7.68301C22.0128 7.68301 20.0692 8.67468 18.7566 10.3977L17.9993 11.4018L17.2421 10.3977C15.9295 8.67468 13.9922 7.68301 11.9098 7.68301Z",
      comment: "M31.942 31.7391L30.3246 25.7068C30.2318 25.3687 30.2782 25.0042 30.4373 24.686C31.8492 21.8555 32.3199 18.4748 31.4515 14.9482C30.2715 10.1754 26.5461 6.34397 21.7866 5.07786C20.4874 4.73979 19.208 4.57407 17.9684 4.57407C9.07252 4.57407 2.12549 12.9198 4.52513 22.2068C5.63878 26.5023 10.2259 30.9502 14.5413 31.9976C15.708 32.2826 16.8548 32.4152 17.9684 32.4152C20.3614 32.4152 22.602 31.7987 24.5707 30.7381C24.7895 30.6188 25.0348 30.5525 25.2734 30.5525C25.3927 30.5525 25.512 30.5658 25.6314 30.5989L31.5045 32.1699C31.5377 32.1766 31.5708 32.1832 31.5973 32.1832C31.8227 32.1832 32.0017 31.9711 31.942 31.7391ZM28.4685 26.204L29.3833 29.6178L26.1285 28.7495C25.8501 28.6765 25.5651 28.6368 25.2734 28.6368C24.7166 28.6368 24.1531 28.7826 23.6493 29.0544C21.8794 30.0089 19.9703 30.4928 17.9684 30.4928C16.9807 30.4928 15.9798 30.3669 14.9921 30.1283C11.3396 29.24 7.31587 25.3157 6.38784 21.7229C5.42002 17.971 6.18234 14.1196 8.47592 11.1565C10.7695 8.19342 14.2298 6.49644 17.9684 6.49644C19.0688 6.49644 20.1891 6.64227 21.2961 6.94057C25.3861 8.0277 28.5613 11.2758 29.5888 15.4122C30.3113 18.3289 30.013 21.239 28.7204 23.8309C28.3492 24.5733 28.2564 25.4151 28.4685 26.204Z M5.04153 22.0737C2.73117 13.1319 9.41367 5.10831 17.9682 5.10831C19.1596 5.10831 20.3933 5.26752 21.6505 5.59452C26.2191 6.81036 29.7996 10.4914 30.9332 15.0769C31.7707 18.4786 31.3156 21.7295 29.9597 24.4479C29.7477 24.8719 29.679 25.3707 29.8093 25.847C29.8094 25.8476 29.8096 25.8481 29.8097 25.8487L31.3453 31.5756L25.7739 30.0853C25.7731 30.0851 25.7722 30.0848 25.7713 30.0846C25.599 30.037 25.4316 30.0194 25.2732 30.0194C24.9384 30.0194 24.6064 30.1115 24.3162 30.2696C22.4211 31.2902 20.2675 31.8821 17.9682 31.8821C16.8971 31.8821 15.7929 31.7547 14.6677 31.4798C12.626 30.9842 10.481 29.6705 8.70488 27.9387C6.92863 26.2068 5.5676 24.1026 5.04153 22.0737ZM17.9682 7.03067C14.3948 7.03067 11.0903 8.65109 8.89768 11.4837C6.70892 14.3114 5.97615 17.9917 6.90428 21.59C7.33676 23.2643 8.50828 25.0622 10.0409 26.5585C11.5729 28.0544 13.4105 29.195 15.1176 29.6102C16.0671 29.8396 17.0258 29.9598 17.9682 29.9598C19.8811 29.9598 21.7032 29.4981 23.3958 28.5853C23.9743 28.2732 24.6245 28.1037 25.2732 28.1037C25.6139 28.1037 25.9444 28.1502 26.2635 28.2338L26.2658 28.2344L28.6286 28.8648L27.9529 26.3431C27.7056 25.4235 27.8154 24.4477 28.2428 23.5928C29.4762 21.1195 29.7639 18.3402 29.0706 15.5415C28.0895 11.5917 25.0586 8.49348 21.1588 7.4569L21.157 7.45643C20.0951 7.17028 19.0215 7.03067 17.9682 7.03067Z M17.9682 4.04102C8.73093 4.04102 1.5194 12.7088 4.00821 22.3409C4.59584 24.6074 6.08528 26.8752 7.95978 28.7029C9.83432 30.5306 12.141 31.9646 14.4144 32.5166C15.6226 32.8118 16.8119 32.9494 17.9682 32.9494C20.4544 32.9494 22.7814 32.3087 24.8236 31.2085L24.826 31.2072C24.973 31.127 25.1311 31.0867 25.2732 31.0867C25.3525 31.0867 25.4229 31.0955 25.4883 31.1137L31.3829 32.6905L31.3996 32.6938L31.4043 32.6948C31.4286 32.6998 31.513 32.7174 31.5971 32.7174C32.1548 32.7174 32.6091 32.192 32.4586 31.6067L30.8398 25.5692L30.8389 25.5661C30.7842 25.3668 30.8086 25.1367 30.9146 24.9248C32.3823 21.9824 32.8683 18.4717 31.9693 14.8207C30.7432 9.8611 26.8734 5.87947 21.9236 4.56274L21.9208 4.562C20.58 4.21312 19.2555 4.04102 17.9682 4.04102ZM17.9682 5.10831C9.41367 5.10831 2.73117 13.1319 5.04153 22.0737C5.5676 24.1026 6.92863 26.2068 8.70488 27.9387C10.481 29.6705 12.626 30.9842 14.6677 31.4798C15.7929 31.7547 16.8971 31.8821 17.9682 31.8821C20.2675 31.8821 22.4211 31.2902 24.3162 30.2696C24.6064 30.1115 24.9384 30.0194 25.2732 30.0194C25.4316 30.0194 25.599 30.037 25.7713 30.0846C25.7722 30.0848 25.7731 30.0851 25.7739 30.0853L31.3453 31.5756L29.8097 25.8487C29.8096 25.8481 29.8094 25.8476 29.8093 25.847C29.679 25.3707 29.7477 24.8719 29.9597 24.4479C31.3156 21.7295 31.7707 18.4786 30.9332 15.0769C29.7996 10.4914 26.2191 6.81036 21.6505 5.59452C20.3933 5.26752 19.1596 5.10831 17.9682 5.10831Z",
      share: "M31.8077 5.08057C32.3461 5.14994 32.8379 5.45824 33.1153 5.9458C33.4345 6.49534 33.4321 7.17237 33.1056 7.72607C28.2658 15.3441 19.3956 31.0317 19.3956 31.0317L19.3946 31.0327C19.0164 31.6718 18.2925 32.0185 17.5567 31.9009C16.8132 31.783 16.2392 31.2307 16.1017 30.4897L13.5841 17.1157L3.254 8.20752C3.10426 8.07536 2.98029 7.92545 2.88291 7.76611L2.879 7.75928L2.78916 7.57959C2.60999 7.16406 2.59773 6.6887 2.76279 6.24854C3.02474 5.55306 3.68085 5.08552 4.43662 5.08545L31.5743 5.06592L31.8077 5.08057ZM16.6026 17.0757L18.4356 26.814L28.0001 10.5767L16.6026 17.0757ZM15.1358 14.52L26.5108 8.02978H7.61631L15.1358 14.52Z",
      bookmark: "M29.1336 3.64624H6.80286C5.92559 3.64624 5.20781 4.29272 5.20781 5.09175V33.0867C5.20781 33.8857 5.7262 34.0891 6.3722 33.5298L17.3222 24.0722C17.5774 23.8543 18.0001 23.8543 18.2553 24.065L29.5563 33.5516C30.2023 34.0964 30.7286 33.8857 30.7286 33.0867V5.09175C30.7286 4.29272 30.0188 3.64624 29.1336 3.64624ZM28.3361 29.571L19.8743 22.4669C19.2841 21.973 18.5424 21.726 17.7928 21.726C17.0271 21.726 16.2695 21.9802 15.6793 22.4887L7.60039 29.4693V5.8254H28.3361V29.571Z M4.6875 5.0766C4.6875 3.94545 5.68444 3.12549 6.78267 3.12549H29.1548C30.2627 3.12549 31.25 3.94698 31.25 5.0766V33.1016C31.25 33.5792 31.0891 34.1096 30.5897 34.3081C30.119 34.4951 29.6295 34.2655 29.2608 33.9549C29.2609 33.955 29.2607 33.9548 29.2608 33.9549L17.9427 24.4612C17.9423 24.4609 17.942 24.4607 17.9416 24.4604C17.8689 24.4016 17.7134 24.4028 17.6424 24.4626C17.6426 24.4624 17.6421 24.4628 17.6424 24.4626L6.67392 33.9286C6.31039 34.2431 5.82307 34.4866 5.34919 34.3047C4.84337 34.1106 4.6875 33.5733 4.6875 33.1016V5.0766ZM6.78267 4.13358C6.12309 4.13358 5.68182 4.60798 5.68182 5.0766V33.1016C5.68182 33.2335 5.70123 33.3126 5.71707 33.3529C5.72333 33.3513 5.73057 33.3492 5.73886 33.3464C5.80126 33.3253 5.90006 33.2729 6.02849 33.1618L16.9993 23.6937L17.0014 23.6918C17.4417 23.3162 18.1313 23.3173 18.5701 23.6792L18.5733 23.6818L29.8961 33.1794C30.0231 33.2864 30.1209 33.3361 30.1829 33.3557C30.1968 33.3598 30.2074 33.3623 30.2157 33.3639C30.2327 33.3267 30.2563 33.2453 30.2563 33.1015V5.0765C30.2563 4.60635 29.8213 4.13349 29.1554 4.13349H6.78326ZM7.0851 5.30689H28.8536V30.6533L19.5626 22.8592C19.5627 22.8593 19.5625 22.8591 19.5626 22.8592C19.0673 22.4451 18.4382 22.2327 17.7936 22.2327C17.1328 22.2327 16.4909 22.452 15.998 22.8764L7.0851 30.5715V5.30689ZM8.07942 6.31499V28.389L15.3544 22.1079C16.044 21.5143 16.9203 21.2246 17.7936 21.2246C18.6509 21.2246 19.5082 21.5069 20.1953 22.0815L27.8592 28.5108V6.31499H8.07942Z",
      more: "M5.69238 14C7.73155 14 9.38477 15.6532 9.38477 17.6924C9.38473 19.7315 7.73153 21.3847 5.69238 21.3848C3.6532 21.3848 2.00004 19.7316 2 17.6924C2 15.6532 3.65318 14 5.69238 14ZM18 14C20.0392 14 21.6924 15.6532 21.6924 17.6924C21.6924 19.7316 20.0392 21.3848 18 21.3848C15.9608 21.3848 14.3076 19.7316 14.3076 17.6924C14.3076 15.6532 15.9608 14 18 14ZM30.3076 14C32.3468 14 34 15.6532 34 17.6924C34 19.7316 32.3468 21.3848 30.3076 21.3848C28.2684 21.3847 26.6152 19.7316 26.6152 17.6924C26.6152 15.6532 28.2684 14 30.3076 14Z"
    };

    // 1. 获取选中的统计项
    const statsItems = [
      { id: 'ccs-share-messages', label: '聊天对话', value: $("#ccs-messages").text(), unit: '条' },
      { id: 'ccs-share-days', label: '相伴天数', value: $("#ccs-days").text(), unit: '天' },
      { id: 'ccs-share-words', label: '聊天字数', value: $("#ccs-words").text(), unit: '字' },
      {
        id: 'ccs-share-size', label: '回忆大小', value: (() => {
          const val = $("#ccs-total-size").text();
          const match = val.match(/^([\d.]+)\s*(\w+)$/);
          return match ? match[1] : val;
        })(), unit: (() => {
          const val = $("#ccs-total-size").text();
          const match = val.match(/^([\d.]+)\s*(\w+)$/);
          return match ? match[2] : '';
        })()
      }
    ];

    // 如果不是现代简约风，则加上初遇时间显示
    if (!isModern) {
      statsItems.unshift({ id: 'ccs-share-start', label: '初遇时间', value: $("#ccs-start").text().replace(/点/g, ':').replace(/分/g, '') });
    }

    const stats = statsItems.filter(s => $(`#${s.id}`).is(":checked"));

    // 2. 计算动态高度
    const headerH = (shareStyle === 'ins' ? 144 : 214) * scaleFactor;
    const footerH = (shareStyle === 'ins' ? 92 : 48) * scaleFactor;
    const boxH = 80 * scaleFactor;
    const boxGap = 32 * scaleFactor;

    // Ins style: fixed height for content area vs others
    const totalStatsH = (shareStyle === 'ins')
      ? (500 * scaleFactor) // Fixed height for ins content
      : (stats.length > 0 ? (stats.length * boxH + (stats.length - 1) * boxGap + 80 * scaleFactor) : 0);

    const height = headerH + totalStatsH + footerH;
    const dynamicHeight = height;

    // 现代版底色区域 (This block is now mostly for non-ins styles)
    const contentAreaMargin = 32 * scaleFactor;
    const contentAreaW = isModern ? 599 * scaleFactor : (540 * scaleFactor);
    // const contentAreaH = hasStats ? (statsAreaH + 80 * scaleFactor) : 0; // Padding inside content (now totalStatsH)

    canvas.width = width;
    canvas.height = dynamicHeight;

    // Apply 16px border radius to the entire card
    ctx.save();
    roundRect(0, 0, width, dynamicHeight, 16 * scaleFactor, false, false);
    ctx.clip();

    // 尝试加载字体并等待加载完成
    try {
      if (document.fonts) {
        // Trigger font loading
        const fontPromises = [
          document.fonts.load(`400 32px "LXGW Neo XiHei"`),
          document.fonts.load(`700 32px "LXGW Neo XiHei"`),
          document.fonts.load(`400 32px "PING FANG SHAO HUA"`),
          document.fonts.load(`400 48px "Long Cang"`)
        ];

        // Wait for fonts to load, with a timeout to prevent hanging forever
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 1500));
        await Promise.race([Promise.all(fontPromises), timeoutPromise]);
      }
    } catch (e) {
      if (DEBUG) console.warn('Font load trigger failed:', e);
    }

    // Helper: Rounded Rect
    function roundRect(x, y, w, h, r, fill = true, stroke = false) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    // 3. 绘制背景
    ctx.fillStyle = (shareStyle === 'ins') ? '#FFFFFF' : tealColor; // Ins style is white overall
    if (shareStyle === 'ins') {
      roundRect(0, 0, width, height, 24 * scaleFactor);
    } else {
      ctx.fillRect(0, 0, width, headerH);
      ctx.fillStyle = cardBgColor;
      ctx.fillRect(0, headerH, width, dynamicHeight - headerH);
    }


    // 4. 内容区域背景
    if (shareStyle === 'ins') {
      // Mesh Gradient for Ins Style - Use PNG if loaded, else skip mesh generator
      if (insAssets.bg) {
        ctx.drawImage(insAssets.bg, 0, headerH, width, totalStatsH);
      } else {
        ctx.fillStyle = '#E8F5E9'; // Fallback
        ctx.fillRect(0, headerH, width, totalStatsH);
      }
    } else if (stats.length > 0) {
      ctx.fillStyle = contentAreaBg;
      const contentAreaW = 599 * scaleFactor;
      const contentAreaX = (width - contentAreaW) / 2;
      // const contentAreaH = totalStatsH; // Already defined as totalStatsH
      roundRect(contentAreaX, headerH, contentAreaW, totalStatsH, 24 * scaleFactor);
    }


    // 4. 绘制头像 (Moved to after background, before header logic)
    const avatarUrl = getCharacterAvatar();
    const userAvatarUrl = getUserAvatar();

    const loadImg = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => {
        console.warn(`Avatar load timeout: ${url}`);
        resolve(null);
      }, 5000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); resolve(null); };
      img.src = url;
    });

    const [charImg, userImg] = await Promise.all([loadImg(avatarUrl), loadImg(userAvatarUrl)]);

    function drawRoundedAvatar(img, x, y, w, h, r) {
      ctx.save();
      roundRect(x, y, w, h, r, false, false);
      ctx.clip();
      if (img) {
        const scale = Math.max(w / img.width, h / img.height);
        const sw = img.width * scale;
        const sh = img.height * scale;
        ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
      } else {
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }

    const showUser = $("#ccs-share-user-avatar").is(":checked") && userImg;
    const showEncounterDate = $("#ccs-share-start").is(":checked");
    const centerY = headerH / 2;

    if (shareStyle === 'ins') {
      const avatarW = 72 * scaleFactor;
      const avatarH = 72 * scaleFactor;
      const avatarY = (headerH - avatarH) / 2;
      const startX = 24 * scaleFactor;

      function drawInsAvatar(img, x, y) {
        if (!img) return;
        ctx.save();
        // White Border
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2 + 4 * scaleFactor, 0, Math.PI * 2);
        ctx.fillStyle = '#F7F9FB'; // Figma: #f7f9fb
        ctx.fill();
        ctx.lineWidth = 1 * scaleFactor;
        ctx.strokeStyle = '#E0E0E0';
        ctx.stroke();

        // Image
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2, 0, Math.PI * 2);
        ctx.clip();
        // Use charImg/userImg directly, no need to reload
        const iw = img.width;
        const ih = img.height;
        const r = Math.max(avatarW / iw, avatarH / ih);
        const nw = iw * r;
        const nh = ih * r;
        const sx = (iw - avatarW / r) / 2;
        const sy = (ih - avatarH / r) / 2;
        ctx.drawImage(img, sx, sy, avatarW / r, avatarH / r, x, y, avatarW, avatarH);
        ctx.restore();
      }

      if (showUser) {
        drawInsAvatar(userImg, startX + 36 * scaleFactor, avatarY); // User RIGHT (bottom)
        drawInsAvatar(charImg, startX, avatarY); // Character LEFT (top)
      } else {
        drawInsAvatar(charImg, startX, avatarY);
      }

      // Title & Encounter
      const textX = startX + (showUser ? (avatarW + 36 * scaleFactor + 16 * scaleFactor) : (avatarW + 16 * scaleFactor));
      ctx.textAlign = 'left';

      ctx.fillStyle = '#131313';
      ctx.font = `400 ${24 * scaleFactor}px "LXGW Neo XiHei", sans-serif`;

      if (showEncounterDate) {
        ctx.fillText(charName, textX, avatarY + 28 * scaleFactor);
        ctx.fillStyle = '#5E5E5E';
        ctx.font = `400 ${22 * scaleFactor}px "LXGW Neo XiHei", sans-serif`;
        ctx.fillText(`初遇 ${$("#ccs-start").text()}`, textX, avatarY + 60 * scaleFactor);
      } else {
        // Center the name vertically if encounter date is not shown
        ctx.fillText(charName, textX, centerY + 8 * scaleFactor);
      }

      // Three Dots Icon
      ctx.save();
      ctx.translate(width - 48 * scaleFactor, centerY);
      ctx.fillStyle = '#4F4F4F'; // Figma color
      const p = (shareStyle === 'ins' && insIcons.more) ? new Path2D(insIcons.more) : null;
      if (p) {
        ctx.scale(1 * scaleFactor, 1 * scaleFactor); // Figma: 36px total, path fits in 36x36
        ctx.translate(-18, -18); // Center 36x36 path
        ctx.fill(p);
      }
      ctx.restore();

    } else {
      // Modern style header logic...
      const avatarW = 100 * scaleFactor;
      const avatarH = 100 * scaleFactor;
      const avatarGap = -52 * scaleFactor;
      const avatarY = (headerH - avatarH) / 2;

      function drawModernAvatar(img, x, y) {
        // Outer frame
        ctx.fillStyle = isDark ? '#37393B' : 'rgba(220, 221, 220, 1)';
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, (avatarW / 2) + 12 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();

        // Inner Shadow
        ctx.save();
        ctx.shadowColor = isDark ? 'rgba(19, 19, 19, 0.8)' : 'rgba(175, 183, 188, 0.8)';
        ctx.shadowBlur = 18 * scaleFactor;
        ctx.shadowOffsetY = 12 * scaleFactor;

        // Inner Gradient Border (Dark Mode specific inner border)
        const grad = ctx.createLinearGradient(x, y, x, y + avatarH);
        if (isDark) {
          ctx.fillStyle = '#131313'; // Fixed color for Dark Mode per request
        } else {
          grad.addColorStop(0, '#444');
          grad.addColorStop(1, '#000');
          ctx.fillStyle = grad;
        }
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, (avatarW / 2) + 6 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Image with Center Crop (Object-fit: cover)
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + avatarW / 2, y + avatarH / 2, avatarW / 2, 0, Math.PI * 2);
        ctx.clip();
        if (img) {
          const iw = img.width;
          const ih = img.height;
          const r = Math.max(avatarW / iw, avatarH / ih);
          const nw = iw * r;
          const nh = ih * r;
          const sx = (iw - avatarW / r) / 2;
          const sy = (ih - avatarH / r) / 2;
          ctx.drawImage(img, sx, sy, avatarW / r, avatarH / r, x, y, avatarW, avatarH);
        } else {
          ctx.fillStyle = '#ddd';
          ctx.fill();
        }
        ctx.restore();
      };

      if (!showEncounterDate) { // Original logic for modern style when encounter date is not shown
        const combinedW = showUser ? (avatarW * 2 + avatarGap) : avatarW;
        const centerX = (width - combinedW) / 2;
        if (showUser) {
          drawModernAvatar(userImg, centerX + avatarW + avatarGap, avatarY); // User RIGHT (bottom)
        }
        drawModernAvatar(charImg, centerX, avatarY); // Character LEFT (top)
      } else { // Original logic for modern style when encounter date is shown
        const startX = 48 * scaleFactor;
        if (showUser) {
          drawModernAvatar(userImg, startX + avatarW + avatarGap, avatarY); // User RIGHT (bottom)
        }
        drawModernAvatar(charImg, startX, avatarY); // Character LEFT (top)
      }

      if (showEncounterDate) {
        const infoX = 260 * scaleFactor;
        const infoY = centerY;
        ctx.textAlign = 'left';

        // Name
        ctx.fillStyle = charNameColor;
        ctx.font = `400 ${31 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(charName, infoX, infoY - 12 * scaleFactor); // Moved up slightly

        // Encounter Info
        const encounterText = `初遇 ${$("#ccs-start").text()}`;
        ctx.save();
        ctx.globalAlpha = 0.7; // 70% opacity per request
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${25 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(encounterText, infoX, infoY + 36 * scaleFactor); // Moved down slightly (+32 -> +36)
        ctx.restore();
      }
    }

    // 6. 绘制统计项
    const insContentH = 500 * scaleFactor;
    const actualStatsH = stats.length * boxH + (stats.length > 0 ? (stats.length - 1) * boxGap : 0);
    const statsStartY = (shareStyle === 'ins')
      ? (headerH + (insContentH - actualStatsH) / 2) // Vertically centered in fixed height
      : (isModern ? (headerH + 40 * scaleFactor) : (headerH + 100 * scaleFactor + 40 * scaleFactor));

    const boxW = 519 * scaleFactor;
    const boxX = (width - boxW) / 2;

    stats.forEach((stat, i) => {
      const cy = statsStartY + i * (boxH + boxGap);

      if (shareStyle === 'ins') {
        // Ins style: Left aligned with 40px spacing
        ctx.textAlign = 'left';
        ctx.fillStyle = '#131313';
        ctx.font = `400 ${46 * scaleFactor}px "PING FANG SHAO HUA", sans-serif`;

        const labelText = `${stat.label}   ${stat.value} ${stat.unit || ''}`;
        ctx.fillText(labelText, 40 * scaleFactor, cy + boxH / 2 + 10 * scaleFactor);
      } else {
        // Shadow for Modern Style
        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 24 * scaleFactor;
        ctx.shadowOffsetY = 12 * scaleFactor;
        ctx.fillStyle = statBoxColor;
        roundRect(boxX, cy, boxW, boxH, 24 * scaleFactor);
        ctx.restore();

        // Label
        ctx.textAlign = 'left';
        ctx.fillStyle = statLabelColor;
        ctx.font = `400 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
        ctx.fillText(stat.label, boxX + 32 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);

        // Value & Unit
        ctx.textAlign = 'right';
        const valueX = boxX + boxW - 32 * scaleFactor;

        if (stat.unit) {
          ctx.save();
          ctx.globalAlpha = 0.7; // 70% opacity for units
          ctx.fillStyle = statLabelColor;
          ctx.font = `400 ${24 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Reverted to 400
          ctx.fillText(stat.unit, valueX, cy + boxH / 2 + 8 * scaleFactor);
          ctx.restore();

          const unitWidth = ctx.measureText(stat.unit).width;
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`; // Weight Bold
          ctx.fillText(stat.value, valueX - unitWidth - 8 * scaleFactor, cy + boxH / 2 + 8 * scaleFactor);
        } else {
          ctx.fillStyle = statValueColor;
          ctx.font = `700 ${28 * scaleFactor}px "LXGW Neo XiHei", "PingFang SC", sans-serif`;
          ctx.fillText(stat.value, valueX, cy + boxH / 2 + 8 * scaleFactor);
        }
      }
    });

    // 7. 绘制底部互动栏 (Ins Style Only)
    if (shareStyle === 'ins') {
      const footerY = height - footerH;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, footerY, width, footerH);

      const iconY = footerY + 30 * scaleFactor;
      const startX = 32 * scaleFactor;
      const iconGap = 20 * scaleFactor; // Adjusted gap for SVG
      const iconSize = 36 * scaleFactor; // Figma size

      function drawPngIcon(path, x, y) {
        if (!path) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#333333';
        const p = new Path2D(path);
        ctx.scale(iconSize / 36, iconSize / 36); // Original paths are 36x36
        ctx.fill(p);
        ctx.restore();
      }

      drawPngIcon(insIcons.heart, startX, iconY);
      drawPngIcon(insIcons.comment, startX + iconSize + iconGap, iconY);
      drawPngIcon(insIcons.share, startX + (iconSize + iconGap) * 2, iconY);
      drawPngIcon(insIcons.bookmark, width - startX - iconSize, iconY);
    }

    ctx.restore(); // Restore from card-level 16px clipping
    return canvas.toDataURL('image/png');
  }

  function showPreview(imageData) {
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");

    // 清空之前的内容
    $container.empty();

    // 创建预览图片
    const img = new Image();
    img.src = imageData;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '5px';

    // 添加到容器
    $container.append(img);

    // 显示模态框
    $modal.css('display', 'flex');
  }

  // 添加刷新按钮事件处理
  $("#ccs-refresh").on("click", async function () {
    const $button = $(this);

    // 禁用按钮并显示更新中状态
    $button.prop('disabled', true).val('更新中...');

    try {
      // 更新统计
      await updateStats();

      // 显示更新成功状态
      $button.val('已更新');
    } catch (error) {
      console.error('更新统计数据失败:', error);
      $button.val('更新失败');
    } finally {
      // 恢复按钮状态
      setTimeout(() => {
        $button.prop('disabled', false).val('刷新');
      }, 800);
    }
  });

  $("#ccs-share").on("click", async function () {
    const $button = $(this);
    if ($button.prop('disabled')) return; // 如果按钮被禁用，直接返回

    // 确保同步当前的样式选择
    shareStyle = $("#ccs-style-select").val() || 'modern-light';

    $button.prop('disabled', true).val('生成中...');

    // Show modal in loading state first to give immediate feedback
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");
    $container.empty().addClass('loading-preview');
    $modal.css('display', 'flex');

    try {
      const imageData = await generateShareImage();
      // Wait a tiny bit extra just in case
      await new Promise(r => setTimeout(r, 100));
      $container.removeClass('loading-preview');
      showPreview(imageData);
      $button.val('已生成');
    } catch (error) {
      console.error('生成分享图片失败:', error);
      $container.removeClass('loading-preview');
      $container.html('<p style="color:red; padding: 20px;">生成分享图片失败，请检查控制台。</p>');
    } finally {
      setTimeout(() => {
        $button.prop('disabled', false).val('分享');
      }, 1000);
    }
  });

  // 添加取消按钮事件处理
  $("#ccs-cancel").on("click", function () {
    $("#ccs-preview-modal").hide();
  });

  // 添加保存按钮事件
  $("#ccs-download").on("click", function () {
    const characterName = getCurrentCharacterName();
    const link = document.createElement('a');
    link.download = `羁绊卡片_${characterName}.png`;
    link.href = $("#ccs-preview-container img").attr('src');
    link.click();
  });

  // 点击模态框背景关闭
  $("#ccs-preview-modal").on("click", function (e) {
    if (e.target === this) {
      $(this).hide();
    }
  });

  // Debounced update function
  const debouncedUpdateStats = debounce(updateStats, 500); // 500ms delay

  // 初始化时的基本更新
  updateStats(); // Keep initial update on load

  // 风格切换处理 (在预览窗口中)
  $(document).on('change', '#ccs-style-select', async function () {
    shareStyle = $(this).val();
    if (DEBUG) console.log('Selected style changed (dropdown):', shareStyle);

    // 即时重新生成预览
    const $container = $("#ccs-preview-container");
    $container.addClass('loading-preview'); // Optional: visual feedback

    try {
      const imageData = await generateShareImage();
      const $img = $container.find('img');
      if ($img.length) {
        $img.attr('src', imageData);
      }
    } catch (e) {
      console.error('Failed to regenerate preview:', e);
      alert('生成预览失败: ' + e.message);
    } finally {
      $container.removeClass('loading-preview');
    }
  });

  // 绑定点击事件 - 使用事件委托以防动态加载问题
  $(document).on('click', '#ccs-refresh', updateStats);

  // Add change listener to checkboxes to update share button state
  $(document).on('change', '.ccs-share-option input[type="checkbox"]', function () {
    // Re-evaluate button state based on current message count whenever options change
    const currentMessageCount = parseInt($("#ccs-messages").text(), 10) || 0;
    updateShareButtonState(currentMessageCount);
  });

  // Observe character selection changes to trigger auto-refresh
  const selectedCharObserver = new MutationObserver((mutationsList) => {
    // Check if the mutations likely indicate a character change
    // A simple check is often enough, but could be refined if needed
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        if (DEBUG) console.log('Selected character change observed, triggering debounced update...');
        debouncedUpdateStats();
        return; // Only need to trigger once per batch of mutations
      }
    }
  });

  // Find the target element to observe - #rm_button_selected_ch seems appropriate
  const selectedCharElement = document.getElementById("rm_button_selected_ch");
  if (selectedCharElement) {
    if (DEBUG) console.log('Observing #rm_button_selected_ch for mutations.');
    // Observe changes to the children and subtree (like the h2 text changing)
    selectedCharObserver.observe(selectedCharElement, {
      childList: true,
      subtree: true,
      characterData: true // Observe text changes directly within nodes
    });
  } else {
    console.error('#rm_button_selected_ch element not found for MutationObserver.');
  }


  // // 定期更新 (Removed interval-based update)
  // setInterval(updateStats, 30000);

  if (DEBUG) console.log("✅ 聊天陪伴统计插件已加载 (自动刷新已启用)");
});
