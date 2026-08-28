-- ============================================================
-- 自作UIライブラリ (公開用 / loadstring対応)
-- ============================================================

local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local CoreGui = game:GetService("CoreGui")
local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer

local Theme = {
    Background = Color3.fromRGB(5, 5, 5),
    Topbar = Color3.fromRGB(12, 12, 12),
    Sidebar = Color3.fromRGB(10, 10, 10),
    ElementBG = Color3.fromRGB(18, 18, 18),
    Accent = Color3.fromRGB(255, 255, 255),
    TextPrimary = Color3.fromRGB(240, 240, 240),
    TextSecondary = Color3.fromRGB(100, 100, 100),
    Font = Enum.Font.Garamond,
    CornerRadius = UDim.new(0, 3),
}

local function Create(className, properties, children)
    local instance = Instance.new(className)
    for k, v in pairs(properties or {}) do
        if k ~= "Parent" then instance[k] = v end
    end
    for _, child in pairs(children or {}) do child.Parent = instance end
    instance.Parent = properties.Parent
    return instance
end

local Library = {}
Library.__index = Library

function Library:CreateWindow(config)
    config = config or {}
    local self = setmetatable({}, Library)
    self.Tabs = {}
    self.Visible = true
    self.ToggleKey = config.ToggleKey or Enum.KeyCode.RightShift

    local ScreenGui = Create("ScreenGui", {
        Name = "MonochromeUI",
        ResetOnSpawn = false,
        ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
        Parent = CoreGui
    })

    local MainFrame = Create("Frame", {
        Name = "MainFrame",
        Size = UDim2.new(0.95, 0, 0.8, 0),
        Position = UDim2.new(0.5, 0, 0.5, 0),
        AnchorPoint = Vector2.new(0.5, 0.5),
        BackgroundColor3 = Theme.Background,
        BorderSizePixel = 0,
        Parent = ScreenGui
    }, {
        Create("UICorner", { CornerRadius = Theme.CornerRadius }),
        Create("UIStroke", { Color = Color3.fromRGB(40, 40, 40), Thickness = 1 })
    })

    local Topbar = Create("Frame", {
        Name = "Topbar",
        Size = UDim2.new(1, 0, 0, 45),
        BackgroundColor3 = Theme.Topbar,
        BorderSizePixel = 0,
        Parent = MainFrame
    }, {
        Create("UICorner", { CornerRadius = UDim.new(0, 3) }),
        Create("TextLabel", {
            Size = UDim2.new(1, -60, 1, 0),
            Position = UDim2.new(0, 15, 0, 0),
            BackgroundTransparency = 1,
            Text = config.Name or "SYSTEM",
            TextColor3 = Theme.TextPrimary,
            TextSize = 18,
            Font = Theme.Font,
            TextXAlignment = Enum.TextXAlignment.Left
        })
    })

    local CloseButton = Create("TextButton", {
        Name = "CloseButton",
        Size = UDim2.new(0, 30, 0, 30),
        Position = UDim2.new(1, -40, 0.5, -15),
        BackgroundColor3 = Theme.ElementBG,
        BorderSizePixel = 0,
        Text = "—",
        TextColor3 = Theme.TextPrimary,
        TextSize = 16,
        Font = Theme.Font,
        Parent = Topbar
    }, { Create("UICorner", { CornerRadius = UDim.new(0, 3) }) })

    CloseButton.MouseEnter:Connect(function()
        TweenService:Create(CloseButton, TweenInfo.new(0.15), { BackgroundColor3 = Color3.fromRGB(40, 40, 40) }):Play()
    end)
    CloseButton.MouseLeave:Connect(function()
        TweenService:Create(CloseButton, TweenInfo.new(0.15), { BackgroundColor3 = Theme.ElementBG }):Play()
    end)

    local Sidebar = Create("Frame", {
        Name = "Sidebar",
        Size = UDim2.new(0, 140, 1, -45),
        Position = UDim2.new(0, 0, 0, 45),
        BackgroundColor3 = Theme.Sidebar,
        BorderSizePixel = 0,
        Parent = MainFrame
    })

    local TabContainer = Create("Frame", {
        Name = "TabContainer",
        Size = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Parent = Sidebar
    }, {
        Create("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4) }),
        Create("UIPadding", { PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 12), PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) })
    })

    local ContentArea = Create("ScrollingFrame", {
        Name = "ContentArea",
        Size = UDim2.new(1, -150, 1, -55),
        Position = UDim2.new(0, 145, 0, 50),
        BackgroundTransparency = 1,
        BorderSizePixel = 0,
        ScrollBarThickness = 2,
        ScrollBarImageColor3 = Theme.Accent,
        CanvasSize = UDim2.new(0, 0, 0, 0),
        AutomaticCanvasSize = Enum.AutomaticSize.Y,
        Parent = MainFrame
    }, {
        Create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 10) }),
        Create("UIPadding", { PaddingTop = UDim.new(0, 5) })
    })

    local MinimizedButton = Create("TextButton", {
        Name = "MinimizedButton",
        Size = UDim2.new(0, 40, 0, 40),
        Position = UDim2.new(0, 20, 0.5, -20),
        BackgroundColor3 = Theme.Background,
        BorderSizePixel = 0,
        Text = "M",
        TextColor3 = Theme.TextPrimary,
        TextSize = 20,
        Font = Theme.Font,
        Visible = false,
        Parent = ScreenGui
    }, {
        Create("UICorner", { CornerRadius = UDim.new(0, 4) }),
        Create("UIStroke", { Color = Color3.fromRGB(40, 40, 40), Thickness = 1 })
    })

    local function ToggleUI()
        self.Visible = not self.Visible
        if self.Visible then
            MinimizedButton.Visible = false
            MainFrame.Visible = true
            MainFrame.Size = UDim2.new(0, 0, 0, 0)
            MainFrame.BackgroundTransparency = 1
            TweenService:Create(MainFrame, TweenInfo.new(0.5, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
                Size = UDim2.new(0.95, 0, 0.8, 0),
                BackgroundTransparency = 0
            }):Play()
        else
            TweenService:Create(MainFrame, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.In), {
                Size = UDim2.new(0, 0, 0, 0),
                BackgroundTransparency = 1
            }):Play()
            task.delay(0.3, function()
                MainFrame.Visible = false
                MinimizedButton.Visible = true
                MinimizedButton.Size = UDim2.new(0, 0, 0, 0)
                TweenService:Create(MinimizedButton, TweenInfo.new(0.4, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
                    Size = UDim2.new(0, 40, 0, 40)
                }):Play()
            end)
        end
    end

    CloseButton.MouseButton1Click:Connect(function() if self.Visible then ToggleUI() end end)
    MinimizedButton.MouseButton1Click:Connect(function() if not self.Visible then ToggleUI() end end)

    local dragging, dragStart, startPos = false, nil, nil
    Topbar.InputBegan:Connect(function(input, gp)
        if gp then return end
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            dragging = true; dragStart = input.Position; startPos = MainFrame.Position
        end
    end)
    Topbar.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then dragging = false end
    end)
    UserInputService.InputChanged:Connect(function(input)
        if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
            local delta = input.Position - dragStart
            MainFrame.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
        end
    end)

    local draggingMini, dragStartMini, startPosMini = false, nil, nil
    MinimizedButton.InputBegan:Connect(function(input, gp)
        if gp then return end
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            draggingMini = true; dragStartMini = input.Position; startPosMini = MinimizedButton.Position
        end
    end)
    MinimizedButton.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then draggingMini = false end
    end)
    UserInputService.InputChanged:Connect(function(input)
        if draggingMini and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
            local delta = input.Position - dragStartMini
            MinimizedButton.Position = UDim2.new(startPosMini.X.Scale, startPosMini.X.Offset + delta.X, startPosMini.Y.Scale, startPosMini.Y.Offset + delta.Y)
        end
    end)

    UserInputService.InputBegan:Connect(function(input, gp)
        if not gp and input.KeyCode == self.ToggleKey then ToggleUI() end
    end)

    self.MainFrame = MainFrame
    self.TabContainer = TabContainer
    self.ContentArea = ContentArea
    return self
end

function Library:CreateTab(name)
    local tab = { Name = name, Sections = {} }
    local TabButton = Create("TextButton", {
        Size = UDim2.new(1, 0, 0, 36), BackgroundColor3 = Theme.ElementBG, BorderSizePixel = 0,
        Text = name:upper(), TextColor3 = Theme.TextSecondary, TextSize = 13, Font = Theme.Font, Parent = self.TabContainer
    }, { Create("UICorner", { CornerRadius = UDim.new(0, 2) }) })

    local TabContent = Create("Frame", {
        Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Visible = false, Parent = self.ContentArea
    }, { Create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 8) }) })

    TabButton.MouseButton1Click:Connect(function()
        for _, t in pairs(self.Tabs) do
            t.Content.Visible = false
            TweenService:Create(t.Button, TweenInfo.new(0.2), { BackgroundColor3 = Theme.ElementBG, TextColor3 = Theme.TextSecondary }):Play()
        end
        TabContent.Visible = true
        TabContent.Position = UDim2.new(0, 0, 0.05, 0)
        TabContent.BackgroundTransparency = 1
        TweenService:Create(TabContent, TweenInfo.new(0.4, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = UDim2.new(0, 0, 0, 0), BackgroundTransparency = 0 }):Play()
        TweenService:Create(TabButton, TweenInfo.new(0.2), { BackgroundColor3 = Theme.Accent, TextColor3 = Theme.Background }):Play()
    end)

    tab.Button = TabButton
    tab.Content = TabContent
    table.insert(self.Tabs, tab)
    if #self.Tabs == 1 then
        TabContent.Visible = true
        TweenService:Create(TabButton, TweenInfo.new(0.2), { BackgroundColor3 = Theme.Accent, TextColor3 = Theme.Background }):Play()
    end
    setmetatable(tab, { __index = self })
    return tab
end

function Library:CreateSection(title)
    local section = {}
    local SectionFrame = Create("Frame", {
        Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = Theme.Background, BorderSizePixel = 0, Parent = self.Content
    }, {
        Create("UICorner", { CornerRadius = UDim.new(0, 3) }),
        Create("UIStroke", { Color = Color3.fromRGB(30, 30, 30), Thickness = 1 }),
        Create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6) }),
        Create("UIPadding", { PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 12), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }),
        Create("TextLabel", { Size = UDim2.new(1, 0, 0, 14), BackgroundTransparency = 1, Text = title:upper(), TextColor3 = Theme.TextSecondary, TextSize = 11, Font = Theme.Font, TextXAlignment = Enum.TextXAlignment.Left })
    })
    section.Frame = SectionFrame
    setmetatable(section, { __index = self })
    return section
end

function Library:CreateToggle(config)
    config = config or {}
    local callback = config.Callback or function() end
    local state = config.Default or false
    local ToggleFrame = Create("Frame", { Size = UDim2.new(1, 0, 0, 32), BackgroundColor3 = Theme.ElementBG, BorderSizePixel = 0, Parent = self.Frame }, {
        Create("UICorner", { CornerRadius = UDim.new(0, 3) }),
        Create("TextLabel", { Size = UDim2.new(1, -60, 1, 0), Position = UDim2.new(0, 12, 0, 0), BackgroundTransparency = 1, Text = config.Name or "Toggle", TextColor3 = Theme.TextPrimary, TextSize = 13, Font = Theme.Font, TextXAlignment = Enum.TextXAlignment.Left })
    })
    local SwitchBG = Create("Frame", { Size = UDim2.new(0, 36, 0, 18), Position = UDim2.new(1, -46, 0.5, -9), BackgroundColor3 = Color3.fromRGB(40, 40, 40), BorderSizePixel = 0, Parent = ToggleFrame }, { Create("UICorner", { CornerRadius = UDim.new(1, 0) }) })
    local SwitchKnob = Create("Frame", { Size = UDim2.new(0, 14, 0, 14), Position = UDim2.new(0, 2, 0.5, -7), BackgroundColor3 = Color3.fromRGB(255, 255, 255), BorderSizePixel = 0, Parent = SwitchBG }, { Create("UICorner", { CornerRadius = UDim.new(1, 0) }) })

    local function UpdateState(newState)
        state = newState
        if state then
            TweenService:Create(SwitchBG, TweenInfo.new(0.3, Enum.EasingStyle.Back), { BackgroundColor3 = Theme.Accent }):Play()
            TweenService:Create(SwitchKnob, TweenInfo.new(0.4, Enum.EasingStyle.Back), { Position = UDim2.new(1, -16, 0.5, -7), BackgroundColor3 = Theme.Background }):Play()
        else
            TweenService:Create(SwitchBG, TweenInfo.new(0.3, Enum.EasingStyle.Back), { BackgroundColor3 = Color3.fromRGB(40, 40, 40) }):Play()
            TweenService:Create(SwitchKnob, TweenInfo.new(0.4, Enum.EasingStyle.Back), { Position = UDim2.new(0, 2, 0.5, -7), BackgroundColor3 = Theme.Accent }):Play()
        end
        callback(state)
    end
    UpdateState(state)
    local clickArea = Create("TextButton", { Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Text = "", Parent = ToggleFrame })
    clickArea.MouseButton1Click:Connect(function() UpdateState(not state) end)
    return { SetState = UpdateState, GetState = function() return state end }
end

function Library:CreateSlider(config)
    config = config or {}
    local min, max, default = config.Min or 0, config.Max or 100, config.Default or (config.Min or 0)
    local callback = config.Callback or function() end
    local value = default
    local SliderFrame = Create("Frame", { Size = UDim2.new(1, 0, 0, 40), BackgroundColor3 = Theme.ElementBG, BorderSizePixel = 0, Parent = self.Frame }, {
        Create("UICorner", { CornerRadius = UDim.new(0, 3) }),
        Create("TextLabel", { Size = UDim2.new(1, -70, 0, 16), Position = UDim2.new(0, 12, 0, 4), BackgroundTransparency = 1, Text = config.Name or "Slider", TextColor3 = Theme.TextPrimary, TextSize = 13, Font = Theme.Font, TextXAlignment = Enum.TextXAlignment.Left })
    })
    local ValueLabel = Create("TextLabel", { Size = UDim2.new(0, 60, 0, 16), Position = UDim2.new(1, -68, 0, 4), BackgroundTransparency = 1, Text = tostring(math.floor(value)), TextColor3 = Theme.TextSecondary, TextSize = 12, Font = Theme.Font, TextXAlignment = Enum.TextXAlignment.Right, Parent = SliderFrame })
    local TrackBG = Create("Frame", { Size = UDim2.new(1, -24, 0, 6), Position = UDim2.new(0, 12, 1, -14), BackgroundColor3 = Color3.fromRGB(30, 30, 30), BorderSizePixel = 0, Parent = SliderFrame }, { Create("UICorner", { CornerRadius = UDim.new(1, 0) }) })
    local Fill = Create("Frame", { Size = UDim2.new((value - min) / (max - min), 0, 1, 0), BackgroundColor3 = Theme.Accent, BorderSizePixel = 0, Parent = TrackBG }, { Create("UICorner", { CornerRadius = UDim.new(1, 0) }) })
    local Knob = Create("Frame", { Size = UDim2.new(0, 12, 0, 12), Position = UDim2.new((value - min) / (max - min), -6, 0.5, -6), BackgroundColor3 = Theme.Accent, BorderSizePixel = 0, Parent = TrackBG }, { Create("UICorner", { CornerRadius = UDim.new(1, 0) }) })

    local function SetValue(newValue)
        value = math.clamp(newValue, min, max)
        local ratio = (value - min) / (max - min)
        Fill.Size = UDim2.new(ratio, 0, 1, 0)
        Knob.Position = UDim2.new(ratio, -6, 0.5, -6)
        ValueLabel.Text = tostring(math.floor(value))
        callback(value)
    end

    local draggingSlider = false
    local function updateFromInput(input)
        local ratio = math.clamp((input.Position.X - TrackBG.AbsolutePosition.X) / TrackBG.AbsoluteSize.X, 0, 1)
        SetValue(min + (max - min) * ratio)
    end

    TrackBG.InputBegan:Connect(function(input, gp)
        if gp then return end
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            draggingSlider = true; updateFromInput(input)
        end
    end)
    TrackBG.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then draggingSlider = false end
    end)
    UserInputService.InputChanged:Connect(function(input)
        if draggingSlider and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then updateFromInput(input) end
    end)
    SetValue(default)
    return { SetValue = SetValue, GetValue = function() return value end }
end

function Library:CreateDropdown(config)
    config = config or {}
    local options = config.Options or {}
    local callback = config.Callback or function() end
    local selectedValue = config.Default or options[1]
    local isOpen = false
    local itemHeight = 28
    local padding = 4
    local totalListHeight = (#options * itemHeight) + ((#options - 1) * 2) + (padding * 2)

    local DropdownFrame = Create("Frame", { Size = UDim2.new(1, 0, 0, 32), BackgroundColor3 = Theme.ElementBG, BorderSizePixel = 0, ClipsDescendants = true, Parent = self.Frame }, { Create("UICorner", { CornerRadius = UDim.new(0, 3) }) })
    local Header = Create("TextButton", { Size = UDim2.new(1, 0, 0, 32), BackgroundTransparency = 1, Text = "", Parent = DropdownFrame })
    local Label = Create("TextLabel", { Size = UDim2.new(1, -40, 1, 0), Position = UDim2.new(0, 12, 0, 0), BackgroundTransparency = 1, Text = selectedValue or "Select...", TextColor3 = Theme.TextPrimary, TextSize = 13, Font = Theme.Font, TextXAlignment = Enum.TextXAlignment.Left, Parent = Header })
    local Arrow = Create("TextLabel", { Size = UDim2.new(0, 20, 0, 32), Position = UDim2.new(1, -30, 0, 0), BackgroundTransparency = 1, Text = "▼", TextColor3 = Theme.TextSecondary, TextSize = 12, Font = Theme.Font, Parent = Header })

    local ListContainer = Create("Frame", { Size = UDim2.new(1, 0, 0, 0), Position = UDim2.new(0, 0, 0, 32), BackgroundColor3 = Color3.fromRGB(15, 15, 15), BorderSizePixel = 0, Parent = DropdownFrame }, {
        Create("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 2) }),
        Create("UIPadding", { PaddingTop = UDim.new(0, padding), PaddingBottom = UDim.new(0, padding), PaddingLeft = UDim.new(0, padding), PaddingRight = UDim.new(0, padding) })
    })

    for _, option in ipairs(options) do
        local ItemButton = Create("TextButton", { Size = UDim2.new(1, 0, 0, itemHeight), BackgroundColor3 = Color3.fromRGB(15, 15, 15), BorderSizePixel = 0, Text = option, TextColor3 = Theme.TextPrimary, TextSize = 12, Font = Theme.Font, AutoButtonColor = false, Parent = ListContainer }, { Create("UICorner", { CornerRadius = UDim.new(0, 2) }) })
        ItemButton.MouseEnter:Connect(function() TweenService:Create(ItemButton, TweenInfo.new(0.1), { BackgroundColor3 = Theme.ElementBG }):Play() end)
        ItemButton.MouseLeave:Connect(function() TweenService:Create(ItemButton, TweenInfo.new(0.1), { BackgroundColor3 = Color3.fromRGB(15, 15, 15) }):Play() end)
        ItemButton.MouseButton1Click:Connect(function()
            selectedValue = option
            Label.Text = option
            callback(option)
            ToggleDropdown(false)
        end)
    end

    local function ToggleDropdown(state)
        if state == nil then state = not isOpen end
        isOpen = state
        local targetListSize = isOpen and UDim2.new(1, 0, 0, totalListHeight) or UDim2.new(1, 0, 0, 0)
        local targetFrameSize = isOpen and UDim2.new(1, 0, 0, 32 + totalListHeight) or UDim2.new(1, 0, 0, 32)
        local targetRotation = isOpen and 180 or 0

        TweenService:Create(ListContainer, TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Size = targetListSize }):Play()
        TweenService:Create(DropdownFrame, TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Size = targetFrameSize }):Play()
        TweenService:Create(Arrow, TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Rotation = targetRotation }):Play()
    end

    Header.MouseButton1Click:Connect(function() ToggleDropdown() end)
    return { SetText = function(text) Label.Text = text end, GetSelected = function() return selectedValue end }
end

-- ★ここが最も重要です。ライブラリ本体を外部に渡します★
return Library
