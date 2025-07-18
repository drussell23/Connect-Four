# 🧠 Model Management

This directory contains machine learning models for the Connect Four AI system.

## 📁 Directory Structure

```
models/
├── README.md                    # This file
├── best_policy_net.pt          # Production model (tracked in Git LFS)
├── current_policy_net.pt       # Current working model (tracked in Git LFS)
├── model_config.json           # Model configuration
└── .gitignore                  # Smart file filtering
```

## 🎯 Model Types

### Production Models (Tracked in Git)
- `best_policy_net.pt` - Best performing model for production
- `current_policy_net.pt` - Current model under evaluation
- `production_*.pt` - Other production-ready models

### Training Snapshots (Ignored by Git)
- `fine_tuned_*.pt` - Training checkpoint snapshots
- `checkpoint_*.pt` - Epoch-based checkpoints
- `epoch_*.pt` / `step_*.pt` - Training progress snapshots

### Development Models (Ignored by Git)
- `*_dev.pt` / `*_test.pt` - Development and testing models
- `*_experiment.pt` - Experimental models
- `*_debug.pt` - Debug models

## 🛠️ Management Commands

```bash
# Clean up old training snapshots
npm run models:cleanup

# Dry run (see what would be cleaned)
npm run models:cleanup:dry

# Force cleanup without prompts
npm run models:cleanup:force

# Monitor repository health
npm run models:monitor

# Check model health
npm run models:health
```

## 📊 Git LFS Integration

Large model files (>10MB) are automatically stored in Git LFS for:
- ✅ Faster git operations (clone, pull, push)
- ✅ Reduced repository size
- ✅ Better performance with large files

## 🔧 Manual LFS Commands

```bash
# Check LFS status
git lfs ls-files

# Track new file types
git lfs track "*.onnx"

# Migrate existing files
git lfs migrate import --include="*.pt"

# Check LFS storage usage
git lfs ls-files --size
```

## 📋 Best Practices

1. **Keep only essential models in Git**
   - Production models: ✅ Track
   - Training snapshots: ❌ Don't track

2. **Use descriptive naming**
   - `best_policy_net_v2.pt` ✅
   - `model_1234.pt` ❌

3. **Regular cleanup**
   - Run `npm run models:cleanup` weekly
   - Keep <20 model files total

4. **Backup important models**
   - Production models are auto-backed up
   - Use external storage for training data

## 🚨 Troubleshooting

### Large Repository Size
```bash
# Check what's taking space
npm run models:monitor

# Clean up training snapshots
npm run models:cleanup:force

# Optimize git repository
git gc --aggressive
```

### LFS Issues
```bash
# Re-initialize LFS
git lfs install --force

# Check LFS configuration
git lfs track

# Verify file is in LFS
git lfs ls-files | grep your_file.pt
```

---
*Auto-generated by Model Management System*
