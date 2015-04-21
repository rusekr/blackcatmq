SVN_SERVER              := http://svn.teligent.ru/teligent/core
BUILD_TOOLS_SVN_TAG	:= F_BUILD_2_0_22
SPEC_DEFAULTS_TAG	:= tags/0.1.4

MODULE		:= blackcatmq
MODULE_LO	:= $(shell echo $(MODULE) | tr A-Z a-z)
PRODUCT		:= osdp
PRODUCT_UP	:= $(shell echo $(PRODUCT) | tr a-z A-Z)

################################################################################
# Only change the lines below if you want to change dependencies in the build
################################################################################

BUILD_TOOLS_SVN_PATH := builds/build_tools
BUILD_TOOLS_MODULE   := build_tools

# Needs to be specified before include
RPM_NAME             := $(MODULE_LO)

# global_start contains common targets and defined Make variables used in this file
-include $(BUILD_TOOLS_MODULE)/global_start.mak

# Modules to run make in
# Used in do-make target
MAKE_MODULES := $(BP)/src

# RPM file parameters used during do-package
# Used in do-package target
RPM_VERSION	:= $(shell git describe)
RPM_RELEASE	:= 1
RPM_SPEC_FILE	:= $(BP)/app.spec

# Specify file server, location on file server and packages to copy to file server
# Used in scp target
DIST_LOCATION	:= $(DIST_LOCATION_BASE)/products/$(PRODUCT)/$(MODULE)/$(DIST)/.
PACKAGES        := $(wildcard $(BP)/rpm/RPMS/*/$(RPM_NAME)-*.rpm)
REPORT_LOCATION := $(DIST_LOCATION_BASE)/products/$(PRODUCT)/$(MODULE)/.log/$(DIST)
REPORT          := $(wildcard $(BP)/html/*)

all: build do-package do-report

build_tools/global_start.mak :.
	svn co -q $(SVN_SERVER)/$(BUILD_TOOLS_SVN_PATH)/tags/$(BUILD_TOOLS_SVN_TAG) $(BUILD_TOOLS_MODULE)

build: 
	npm install --no-optional | tee -a $(LOGFILE)

clean:
	git clean -dxf