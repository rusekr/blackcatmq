Summary: Simple STOMP messages broker
Name: %{name}
Version: %{version}
Release: 1
URL: http://www.teligent.ru
Vendor: Teligent OOO
License: Commercial
Group: Applications/System
BuildRoot: %{abs_top_builddir}/rpm/BUILD
Requires: nodejs
Prefix: /opt
BuildArch: x86_64

%define __jar_repack 0
%description
Simple STOMP messages broker (aka STOMP server) in node.js
%{?desc}

%prep

%build

%install
rm -rf $RPM_BUILD_ROOT%{prefix}/%{name}
cd %{abs_top_builddir}/
mkdir -p $RPM_BUILD_ROOT{%{prefix}/%{name},/usr/lib/systemd/system}
rsync -a --exclude ".git" --exclude "rpm" --exclude build_tools --exclude Makefile --exclude app.spec --exclude ".gitignore" --exclude .var.inc --exclude "blackcatmq.service" --exclude "*.log" %{abs_top_builddir}/ $RPM_BUILD_ROOT%{prefix}/%{name}
cp -a %{abs_top_builddir}/blackcatmq.service $RPM_BUILD_ROOT/usr/lib/systemd/system

%pre

%post


%preun

%postun

%clean
rm -rf $RPM_BUILD_ROOT

%files
%defattr(-,root,root)
%{prefix}/*
/usr/lib/systemd/system/blackcatmq.service
