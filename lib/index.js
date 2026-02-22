'use strict';

const { Schema, h } = require('koishi');
const fs = require('fs');
const path = require('path');

exports.name = 'zimage';
exports.reusable = true;

const MODEL_NAMES = ['z-image-turbo', 'z-image'];
const MODELS = {
  'z-image-turbo': 'Tongyi-MAI/Z-Image-Turbo',
  'z-image': 'Tongyi-MAI/Z-Image'
};

const SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'];

exports.Config = Schema.intersect([
  Schema.object({
    apiKey: Schema.string()
      .description('魔搭API Key (格式: ms-xxxx-xxxx-xxxx-xxxxxxxxxxxx)')
      .role('secret')
      .required(),
  }).description('API配置'),
  Schema.object({
    defaultModel: Schema.union(MODEL_NAMES)
      .description('默认模型')
      .default('z-image-turbo'),
    defaultSize: Schema.union(SIZES)
      .description('默认尺寸')
      .default('1024x1024'),
    defaultSteps: Schema.number()
      .description('默认步长 (turbo建议8, 标准版建议20-50)')
      .default(8)
      .min(1)
      .max(50),
  }).description('生成配置'),
  Schema.object({
    dailyLimit: Schema.number()
      .description('每日调用次数上限 (0为无限制)')
      .default(0)
      .min(0),
    pollInterval: Schema.number()
      .description('轮询间隔(毫秒)')
      .default(3000),
    maxPollTime: Schema.number()
      .description('最大等待时间(毫秒)')
      .default(120000),
  }).description('高级配置'),
  Schema.object({
    bannedWords: Schema.array(String)
      .description('违禁词列表，每行一个')
      .default([]),
    bannedWordsAction: Schema.union(['reject', 'replace'])
      .description('违禁词处理方式: reject=拒绝生成, replace=替换为*')
      .default('reject'),
    msgBanned: Schema.string()
      .description('触发违禁词提示语')
      .default('你的描述包含敏感内容，无法生成喵'),
  }).description('违禁词配置'),
  Schema.object({
    msgGenerating: Schema.string()
      .description('生成中提示语')
      .default('在画了喵'),
    msgError: Schema.string()
      .description('生成失败提示语')
      .default('发生错误了喵'),
    msgLimitReached: Schema.string()
      .description('次数用尽提示语')
      .default('今天的画图次数用完啦喵，明天再来吧'),
    msgNoPrompt: Schema.string()
      .description('未输入提示词提示语')
      .default('请输入描述喵，例如：画图 一只猫咪'),
    msgSuccess: Schema.string()
      .description('成功提示语后缀')
      .default('喵'),
  }).description('提示语配置'),
]);

// 获取今日日期字符串
function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 检查违禁词
function checkBannedWords(text, bannedWords) {
  const lowerText = text.toLowerCase();
  const found = [];
  
  for (const word of bannedWords) {
    if (!word || !word.trim()) continue;
    const lowerWord = word.toLowerCase().trim();
    if (lowerText.includes(lowerWord)) {
      found.push(word.trim());
    }
  }
  
  return found;
}

// 替换违禁词
function replaceBannedWords(text, bannedWords) {
  let result = text;
  for (const word of bannedWords) {
    if (!word || !word.trim()) continue;
    const regex = new RegExp(word.trim(), 'gi');
    result = result.replace(regex, '*'.repeat(word.trim().length));
  }
  return result;
}

exports.apply = function(ctx, config) {
  const logger = ctx.logger('zimage');
  
  const SUBMIT_URL = 'https://api-inference.modelscope.cn/v1/images/generations';
  const TASK_URL = 'https://api-inference.modelscope.cn/v1/tasks/';
  
  // 调用计数存储
  const dataDir = path.resolve('./data/zimage');
  const countFile = path.join(dataDir, 'daily_count.json');
  const bannedWordsFile = path.join(dataDir, 'banned_words.json');
  
  // 确保目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 读取计数
  function loadCount() {
    try {
      if (fs.existsSync(countFile)) {
        const data = JSON.parse(fs.readFileSync(countFile, 'utf-8'));
        if (data.date === getTodayStr()) {
          return data.count || 0;
        }
      }
    } catch (e) {
      logger.warn('读取计数失败:', e);
    }
    return 0;
  }
  
  // 保存计数
  function saveCount(count) {
    try {
      fs.writeFileSync(countFile, JSON.stringify({ date: getTodayStr(), count: count }));
    } catch (e) {
      logger.warn('保存计数失败:', e);
    }
  }
  
  // 增加计数
  function incrementCount() {
    const count = loadCount() + 1;
    saveCount(count);
    return count;
  }
  
  // 获取违禁词列表（合并配置和动态添加的）
  function getBannedWords() {
    let words = [...(config.bannedWords || [])];
    
    // 读取动态添加的违禁词
    try {
      if (fs.existsSync(bannedWordsFile)) {
        const data = JSON.parse(fs.readFileSync(bannedWordsFile, 'utf-8'));
        words = [...new Set([...words, ...(data.words || [])])];
      }
    } catch (e) {
      logger.warn('读取违禁词失败:', e);
    }
    
    return words.filter(w => w && w.trim());
  }
  
  // 保存动态违禁词
  function saveBannedWords(words) {
    try {
      fs.writeFileSync(bannedWordsFile, JSON.stringify({ words: words }));
    } catch (e) {
      logger.warn('保存违禁词失败:', e);
    }
  }
  
  async function generateImage(prompt, model, size, steps) {
    // 提交任务
    const submitResponse = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey,
        'X-ModelScope-Async-Mode': 'true'
      },
      body: JSON.stringify({
        model: MODELS[model] || MODELS['z-image-turbo'],
        prompt: prompt,
        size: size,
        steps: steps
      })
    });
    
    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error('提交失败: ' + submitResponse.status + ' - ' + errText);
    }
    
    const submitResult = await submitResponse.json();
    logger.info('任务提交响应:', submitResult);
    
    const taskId = submitResult.task_id || submitResult.id;
    if (!taskId) {
      if (submitResult.images && submitResult.images[0]) {
        return submitResult.images[0].url;
      }
      if (submitResult.data && submitResult.data[0]) {
        return submitResult.data[0].url || submitResult.data[0].base64;
      }
      throw new Error('未获取到任务ID');
    }
    
    logger.info('任务ID:', taskId);
    
    // 轮询结果
    const startTime = Date.now();
    while (Date.now() - startTime < config.maxPollTime) {
      await new Promise(r => setTimeout(r, config.pollInterval));
      
      const taskResponse = await fetch(TASK_URL + taskId, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + config.apiKey,
          'X-ModelScope-Task-Type': 'image_generation'
        }
      });
      
      if (!taskResponse.ok) {
        logger.warn('轮询失败:', taskResponse.status);
        continue;
      }
      
      const taskResult = await taskResponse.json();
      const status = taskResult.task_status;
      logger.debug('任务状态:', status);
      
      if (status === 'SUCCEED') {
        const outputImages = taskResult.output_images || [];
        if (outputImages.length > 0) {
          return outputImages[0];
        }
        if (taskResult.image_url) return taskResult.image_url;
        if (taskResult.data && taskResult.data[0]) {
          return taskResult.data[0].url || taskResult.data[0].base64;
        }
        throw new Error('任务成功但未返回图片');
      }
      
      if (status === 'FAILED') {
        throw new Error('任务执行失败');
      }
    }
    
    throw new Error('生成超时，请稍后再试');
  }

  ctx.command('画图 <prompt:text>', 'AI生成图片')
    .alias('draw')
    .option('model', '-m <model:string> 模型')
    .option('size', '-s <size:string> 尺寸')
    .option('steps', '-t <steps:number> 步长')
    .action(async ({ session, options }, prompt) => {
      if (!prompt || !prompt.trim()) {
        return config.msgNoPrompt;
      }
      
      // 检查调用上限
      if (config.dailyLimit > 0) {
        const currentCount = loadCount();
        if (currentCount >= config.dailyLimit) {
          return config.msgLimitReached;
        }
      }
      
      // 检查违禁词
      const bannedWords = getBannedWords();
      const foundWords = checkBannedWords(prompt, bannedWords);
      
      if (foundWords.length > 0) {
        logger.info('触发违禁词:', foundWords);
        
        if (config.bannedWordsAction === 'reject') {
          return config.msgBanned;
        } else {
          // 替换模式
          prompt = replaceBannedWords(prompt, foundWords);
          logger.info('已替换违禁词，新提示词:', prompt);
        }
      }
      
      const model = options.model || config.defaultModel;
      const size = options.size || config.defaultSize;
      const steps = options.steps || config.defaultSteps;
      
      await session.send(config.msgGenerating);
      
      try {
        const imageUrl = await generateImage(prompt.trim(), model, size, steps);
        
        // 增加调用计数
        incrementCount();
        
        if (imageUrl.startsWith('http')) {
          return h.image(imageUrl);
        } else {
          return h.image('base64://' + imageUrl);
        }
      } catch (e) {
        logger.error('生成失败:', e);
        return config.msgError + ': ' + e.message;
      }
    });

  ctx.command('画图模型 [model:string]', '设置默认模型')
    .action((_, model) => {
      const suffix = config.msgSuccess;
      if (!model) {
        return '当前模型: ' + config.defaultModel + '\n可用模型: ' + MODEL_NAMES.join(', ') + ' ' + suffix;
      }
      if (!MODEL_NAMES.includes(model)) {
        return '没有这个模型' + suffix + '，可用: ' + MODEL_NAMES.join(', ');
      }
      config.defaultModel = model;
      return '切换成功' + suffix + '，当前模型: ' + model;
    });

  ctx.command('画图尺寸 [size:string]', '设置默认尺寸')
    .action((_, size) => {
      const suffix = config.msgSuccess;
      if (!size) {
        return '当前尺寸: ' + config.defaultSize + '\n可用尺寸: ' + SIZES.join(', ') + ' ' + suffix;
      }
      if (!SIZES.includes(size)) {
        return '没有这个尺寸' + suffix + '，可用: ' + SIZES.join(', ');
      }
      config.defaultSize = size;
      return '切换成功' + suffix + '，当前尺寸: ' + size;
    });

  ctx.command('画图步长 [steps:number]', '设置默认步长')
    .action((_, steps) => {
      const suffix = config.msgSuccess;
      if (!steps) {
        return '当前步长: ' + config.defaultSteps + ' (范围: 1-50) ' + suffix;
      }
      if (steps < 1 || steps > 50) {
        return '步长要在1到50之间' + suffix;
      }
      config.defaultSteps = steps;
      return '设置成功' + suffix + '，当前步长: ' + steps;
    });

  ctx.command('画图状态', '查看今日调用次数')
    .action(() => {
      const count = loadCount();
      const limit = config.dailyLimit;
      const suffix = config.msgSuccess;
      if (limit > 0) {
        return '今日已画图 ' + count + ' 次，剩余 ' + Math.max(0, limit - count) + ' 次' + suffix;
      } else {
        return '今日已画图 ' + count + ' 次，无次数限制' + suffix;
      }
    });

  // 违禁词管理命令
  ctx.command('画图违禁词', '查看违禁词列表')
    .action(() => {
      const words = getBannedWords();
      const suffix = config.msgSuccess;
      if (words.length === 0) {
        return '当前没有设置违禁词' + suffix;
      }
      return '当前违禁词列表 (' + words.length + '个):\n' + words.map((w, i) => (i + 1) + '. ' + w).join('\n') + ' ' + suffix;
    });

  ctx.command('画图违禁词添加 <word:text>', '添加违禁词')
    .action((_, word) => {
      if (!word || !word.trim()) {
        return '请输入要添加的违禁词' + config.msgSuccess;
      }
      
      const words = getBannedWords();
      const newWord = word.trim();
      
      if (words.includes(newWord)) {
        return '该违禁词已存在' + config.msgSuccess;
      }
      
      words.push(newWord);
      saveBannedWords(words);
      
      return '添加成功' + config.msgSuccess + '，当前共 ' + words.length + ' 个违禁词';
    });

  ctx.command('画图违禁词删除 <word:text>', '删除违禁词')
    .action((_, word) => {
      if (!word || !word.trim()) {
        return '请输入要删除的违禁词' + config.msgSuccess;
      }
      
      const words = getBannedWords();
      const targetWord = word.trim();
      const index = words.indexOf(targetWord);
      
      if (index === -1) {
        return '未找到该违禁词' + config.msgSuccess;
      }
      
      words.splice(index, 1);
      saveBannedWords(words);
      
      return '删除成功' + config.msgSuccess + '，当前共 ' + words.length + ' 个违禁词';
    });

  ctx.command('画图违禁词清空', '清空违禁词列表')
    .action(() => {
      saveBannedWords([]);
      return '已清空所有违禁词' + config.msgSuccess;
    });

  ctx.command('画图帮助', '查看帮助')
    .action(() => {
      return '【Z-Image AI画图】\n\n用法: 画图 <描述>\n\n选项:\n -m <模型> z-image-turbo / z-image\n -s <尺寸> 1024x1024, 1344x768 等\n -t <步长> 1-50\n\n其他命令:\n 画图模型 [名称] - 查看或设置模型\n 画图尺寸 [尺寸] - 查看或设置尺寸\n 画图步长 [数值] - 查看或设置步长\n 画图状态 - 查看今日调用次数\n 画图违禁词 - 查看违禁词列表\n 画图违禁词添加 <词> - 添加违禁词\n 画图违禁词删除 <词> - 删除违禁词\n\n示例:\n 画图 一只猫咪\n 画图 -m z-image -s 1344x768 风景';
    });

  logger.info('Z-Image 插件已加载');
};
