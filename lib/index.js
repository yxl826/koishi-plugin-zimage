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

exports.apply = function(ctx, config) {
  const logger = ctx.logger('zimage');
  
  const SUBMIT_URL = 'https://api-inference.modelscope.cn/v1/images/generations';
  const TASK_URL = 'https://api-inference.modelscope.cn/v1/tasks/';
  
  // 调用计数存储
  const dataDir = path.resolve('./data/zimage');
  const countFile = path.join(dataDir, 'daily_count.json');
  
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

  ctx.command('画图帮助', '查看帮助')
    .action(() => {
      return '【Z-Image AI画图】\n\n用法: 画图 <描述>\n\n选项:\n -m <模型> z-image-turbo / z-image\n -s <尺寸> 1024x1024, 1344x768 等\n -t <步长> 1-50\n\n其他命令:\n 画图模型 [名称] - 查看或设置模型\n 画图尺寸 [尺寸] - 查看或设置尺寸\n 画图步长 [数值] - 查看或设置步长\n 画图状态 - 查看今日调用次数\n\n示例:\n 画图 一只猫咪\n 画图 -m z-image -s 1344x768 风景';
    });

  logger.info('Z-Image 插件已加载');
};
